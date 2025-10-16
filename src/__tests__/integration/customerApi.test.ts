// src/__tests__/integration/customerApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { JobRequest } from '../../models/request';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import {
  AsyncResponseStoreMem,
  IAsyncResponseStore,
} from '../../adapters/async-response-store.mem';
import { DidService } from '../../models/did';
import { createDidServiceId } from '../../utils/did';
import { createOrganizationUrn } from '../../utils/urn';
import { OrganizationUrnParams } from '../../models/entity';
import { testTenant1AlternateName, testTenant1AddressCountry, testTenant1IdType, testTenant1IdValue } from '../data/organization.data';
import { testCreateCustomerJobRequestProfessionalOnboarding } from '../data/customer-onboarding.data';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(
    (jobName: string, jobData: JobRequest) => Promise.resolve(),
  ),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(
    vaultRepository,
    mockKmsService,
  );

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Person Onboarding API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /{tenantId}/.../Person/_batch (Job Submission)', () => {
    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // --- 1. Define constants for URL parameters and expected values ---
      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry.toLowerCase();
      const sector = 'health-care';
      const section = 'individual';
      const format = 'org.schema';
      const resourceType = 'Person'; // CORRECTED
      const action = '_batch';
      const EXPECTED_RETRY_AFTER = '5';

      // --- 2. Programmatically build URLs from constants ---
      const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = registrationUrl.replace(
        '/_batch',
        '/_batch-response',
      );

      const organizationUrnParams: OrganizationUrnParams = {
        namespace: 'antifraud',
        network: 'test-network',
        jurisdiction: jurisdiction,
        version: 'v1',
        sector: sector,
        idType: testTenant1IdType,
        idValue: testTenant1IdValue,
      }
      const tenantUrn = createOrganizationUrn(organizationUrnParams);

      // --- 3. Configure Mocks using the constants ---
      const mockTenantServices: DidService[] = [
        {
          id: createDidServiceId({ version: 'v1', sector, section, format }),
          type: 'IndividualOnboardingService',
          serviceEndpoint: resourceType,
          actions: [action],
        },
      ];
      jest
        .spyOn(tenantsCacheManager, 'getDidServiceConfig')
        .mockReturnValue(mockTenantServices);

      jest.spyOn(tenantsCacheManager, 'getTenantIdentifierUrn').mockReturnValue(tenantUrn);

      const thid = uuidv4();
      const mockDecodedJob: Omit<JobRequest, 'tenantId'> = {
        ...testCreateCustomerJobRequestProfessionalOnboarding,
        resourceType: resourceType,
        action: action,
        input: {
          ...testCreateCustomerJobRequestProfessionalOnboarding.input,
          aud: tenantUrn,
          thid: thid,
        },
        httpMethod: 'POST',
        requestUrl: registrationUrl,
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(
        mockDecodedJob as JobRequest,
      );

      // --- Act ---
      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(mockKmsService.decodeJobRequest).toHaveBeenCalledWith(
        testEncryptedJwe1,
      );

      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.get('Retry-After')).toBe(EXPECTED_RETRY_AFTER);
      expect(response.body).toEqual({});
    });
  });
});
