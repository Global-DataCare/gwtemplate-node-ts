// src/__tests__/integration/fabricEnrollmentApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express = require('express');
import request = require('supertest');
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { JobRequest, DecodedDidcommMessage } from '../../models/request';
import { DidService } from '../../models/did';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { IAsyncResponseStore, AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { testFabricEnrollmentJobInput, testTenantC_DidDocument } from '../data/fabric-enrollment.data';
import { createDidServiceId } from '../../utils/did';
import { testTenant1AddressCountry, testTenant1AlternateName, testTenant1ServiceProviderCategory } from '../data/organization.data';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn((jobName: string, jobData: JobRequest) => Promise.resolve()),
};

const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, mockKmsService);

  mockKmsService.init();

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Fabric Enrollment API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /{tenantId}/cds-.../v1/fabric/org.schema/Action/_batch', () => {
    it('should authorize the controller, queue a job, and return 202 Accepted with a Location header', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'fabric';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = `${enrollmentUrl.replace('/_batch', '/_batch-response')}?thid=${testFabricEnrollmentJobInput.thid}`;

      // Mock the service configuration for the tenant to allow this action
      const mockTenantServices: DidService[] = [
        {
          id: createDidServiceId({ version: 'v1', sector, section, format }),
          type: 'FabricService',
          serviceEndpoint: resourceType,
          actions: [action],
        },
      ];
      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue(mockTenantServices);

      // CORRECTED MOCK: The KMS mock must resolve with a complete JobRequest object,
      // as this is what the type signature of decodeJobRequest in IKmsService expects.
      const mockJobRequest: JobRequest = {
        tenantId: '', // This will be overwritten by the router
        resourceType: 'Action',
        action: '_batch',
        input: testFabricEnrollmentJobInput,
        meta: {},
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockJobRequest);

      // Mock the DID Document retrieval for the authorization check
      jest.spyOn(tenantsCacheManager, 'getDidDocument').mockReturnValue(testTenantC_DidDocument);

      // --- Act ---
      const response = await request(app)
        .post(enrollmentUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      // 1. Verify the authorization flow was executed correctly
      expect(mockKmsService.decodeJobRequest).toHaveBeenCalledWith(testEncryptedJwe1);
      expect(tenantsCacheManager.getDidDocument).toHaveBeenCalledWith(expect.stringContaining(tenantId));

      // 2. Verify that the job was queued ONLY AFTER authorization was successful
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      const queuedJob = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      
      // Assert that the router correctly used the decoded message as the job's input
      expect(queuedJob.input).toEqual(testFabricEnrollmentJobInput);
      expect(queuedJob.tenantId).toBe(tenantId);

      // 3. Verify the response is compliant with the async pattern
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.body).toEqual({});
    });

    it('should return 403 Forbidden if the issuer is not in the DID assertionMethod', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const tenantId = testTenant1AlternateName;
      const enrollmentUrl = `/${tenantId}/cds-US/v1/health-care/fabric/org.schema/Action/_batch`;
      
      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue([ { id: 'any', type: 'any', serviceEndpoint: 'Action', actions: ['_batch'] } ]);

      // Mock the decoded job, but from an UNAUTHORIZED controller
      const jobFromUnauthorizedController: DecodedDidcommMessage = {
        ...testFabricEnrollmentJobInput,
        iss: 'did:web:unauthorized.controller.com',
      };
      // Wrap it in a JobRequest for the mock
      const mockInvalidJobRequest: JobRequest = {
        tenantId: '',
        resourceType: 'Action',
        action: '_batch',
        input: jobFromUnauthorizedController,
        meta: {},
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockInvalidJobRequest);

      // Mock the DID document which does NOT contain the unauthorized controller
      jest.spyOn(tenantsCacheManager, 'getDidDocument').mockReturnValue(testTenantC_DidDocument);

      // --- Act ---
      const response = await request(app)
        .post(enrollmentUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(response.status).toBe(403);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });
  });
});