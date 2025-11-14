// src/__tests__/unit/worker.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import { Worker } from '../../worker';
import { IJobProcessor, ManagerRegistry } from '../../managers/registry';
import { JobRequest } from '../../models/request';
import { testCreateCustomerJobRequestProfessionalOnboarding } from '../data/customer-onboarding.data';
import { createJobName } from '../../utils/naming';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { IPayloadResponse } from '../../models/response';

describe('Worker', () => {
  let worker: Worker;
  let mockManagerRegistry: MockProxy<ManagerRegistry>;
  let mockCustomerManager: MockProxy<IJobProcessor>;
  let mockKmsService: MockProxy<IKmsService>;
  const API_BASE_URL = 'https://api.example.com';

  beforeEach(() => {
    mockCustomerManager = mock<IJobProcessor>();
    mockKmsService = mock<IKmsService>();
    mockManagerRegistry = mock<ManagerRegistry>({
      customerManager: mockCustomerManager,
    });
    
    worker = new Worker(mockManagerRegistry, API_BASE_URL, mockKmsService);
    jest.clearAllMocks();
  });

  it('should route a "Person" resourceType job to the CustomerManager and encode the response', async () => {
    // ARRANGE
    const resourceType = 'Person';
    const vaultId = 'health-care_acme';
    const jobName = createJobName(
      vaultId,
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'acme',
      sector: 'health-care',
      resourceType: resourceType,
      contentType: 'application/json',
    };

    const mockManagerResponse: IPayloadResponse = {
      iss: API_BASE_URL,
      aud: 'urn:did:example:123',
      exp: Math.floor(Date.now() / 1000) + 300,
      thid: job.content.thid,
      body: { data: [] },
    };
    mockCustomerManager.process.mockResolvedValue(mockManagerResponse);
    mockKmsService.getPublicJwks.mockResolvedValue({ keys: [{ kid: 'key-1' } as any]});
    mockKmsService.encodeResponse.mockResolvedValue('encrypted.jwe.string');

    // ACT
    await worker.process(jobName, job);

    // ASSERT
    expect(mockCustomerManager.process).toHaveBeenCalledTimes(1);
    expect(mockCustomerManager.process).toHaveBeenCalledWith(job);
    expect(mockKmsService.encodeResponse).toHaveBeenCalledTimes(1);
    expect(mockKmsService.protectConfidentialData).not.toHaveBeenCalled();
  });

  it('should throw an error for an unconfigured resourceType', async () => {
    // ARRANGE
    const resourceType = 'UnknownResource';
    const jobName = createJobName(
      'health-care_acme',
      resourceType,
      '_batch',
    );
    
    const job: JobRequest = {
      ...testCreateCustomerJobRequestProfessionalOnboarding,
      tenantId: 'health-care_acme',
      resourceType: resourceType,
    };

    // For the error case, the worker creates an IPayloadResponse and then encodes it.
    // We can mock the encode function to simply stringify the payload, so we can inspect it.
    mockKmsService.encodeResponse.mockImplementation(async (payload) => JSON.stringify(payload));

    // ACT
    const responseString = await worker.process(jobName, job);
    const response = JSON.parse(responseString);

    // ASSERT
    expect(mockCustomerManager.process).not.toHaveBeenCalled();
    const errorIssue = response.body.data[0].response.outcome.issue![0];
    expect(errorIssue.diagnostics).toContain(`No manager configured for resourceType '${resourceType}'`);
  });

  describe('Architecture Keeper Tests', () => {
    it('should ALWAYS use encodeResponse for legacy (JSON) requests, NEVER protectConfidentialData', async () => {
      // ARRANGE
      const resourceType = 'Person';
      const jobName = createJobName('health-care_acme', resourceType, '_batch');
      const job: JobRequest = {
        ...testCreateCustomerJobRequestProfessionalOnboarding,
        tenantId: 'acme',
        sector: 'health-care',
        resourceType: resourceType,
        contentType: 'application/json', // This marks it as a "legacy" flow job
      };

      const mockManagerResponse: IPayloadResponse = {
        iss: API_BASE_URL,
        aud: 'urn:did:example:123',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: job.content.thid,
        body: { data: [{ type: 'Bundle', id: 'some-bundle-id' }] },
      };
      mockCustomerManager.process.mockResolvedValue(mockManagerResponse);
      
      const mockRecipientPublicJwks = { keys: [{ kty: 'OKP', crv: 'ML-KEM-768', kid: 'key-1', x: '...' }]};
      mockKmsService.getPublicJwks.mockResolvedValue(mockRecipientPublicJwks);

      // ACT
      await worker.process(jobName, job);

      // ASSERT
      // This is the core of the architectural guarantee.
      // The worker MUST call encodeResponse to ensure the async store gets a consistent JWE string.
      expect(mockKmsService.encodeResponse).toHaveBeenCalledTimes(1);
      expect(mockKmsService.encodeResponse).toHaveBeenCalledWith(
        mockManagerResponse,
        mockRecipientPublicJwks.keys,
        'health-care_acme' // senderVaultId
      );

      // It MUST NOT call protectConfidentialData, which is for at-rest storage in the main vault.
      expect(mockKmsService.protectConfidentialData).not.toHaveBeenCalled();
    });
  });
});
