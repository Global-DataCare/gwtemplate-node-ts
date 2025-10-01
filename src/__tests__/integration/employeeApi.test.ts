// src/__tests__/integration/employeeApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testClaimsTenant1Receptionist1 } from '../data/employee.data';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { JobRequest } from '../../models/request';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import {
  AsyncResponseStoreMem,
  IAsyncResponseStore,
} from '../../adapters/async-response-store.mem';
import { testTenant1Data } from '../data/end-to-end.data';
import { DidService } from '../../models/did';
import { createDidServiceId } from '../../utils/did';
import { createOrganizationUrn } from '../../utils/urn';
import { getTenantVaultId } from '../../utils/tenant';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  // CORRECTED: The addJob method now accepts a job name and the job data.
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
  // We need a real TenantsCacheManager for routing, but we will mock its return values in tests.
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

describe('Employee Creation API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /{tenantId}/.../_batch (Job Submission)', () => {
    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // --- 1. Define constants for URL parameters and expected values ---
      // This makes the test self-documenting and easy to maintain.
      const tenantId = testTenant1Data.alternateName; // "acme"
      const jurisdiction = 'us';
      const sector = 'health-care';
      const section = 'entity';
      const format = 'org.schema';
      const resourceType = 'Employee';
      const action = '_batch';
      const expectedVaultId = getTenantVaultId(sector, tenantId);
      const EXPECTED_RETRY_AFTER = '5';

      // --- 2. Programmatically build URLs from constants ---
      const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = registrationUrl.replace(
        '/_batch',
        '/_batch-response',
      );

      const tenantUrn = createOrganizationUrn({
        namespace: 'antifraud',
        network: 'test-network',
        jurisdiction: jurisdiction,
        version: 'v1',
        sector: sector,
        idType: 'tax',
        idValue: testTenant1Data.taxId,
      });

      // --- 3. Configure Mocks using the constants ---
      const mockTenantServices: DidService[] = [
        {
          id: createDidServiceId({ version: 'v1', sector, section, format }),
          type: 'EntityManagementService',
          serviceEndpoint: resourceType,
          actions: [action],
        },
      ];
      jest
        .spyOn(tenantsCacheManager, 'getDidServiceConfig')
        .mockReturnValue(mockTenantServices);

      jest.spyOn(tenantsCacheManager, 'getTenantUrn').mockReturnValue(tenantUrn);

      const thid = uuidv4();
      // CORRECTED: The mock for the decoded job should represent the raw data from the KMS.
      // The API controller is responsible for adding the canonical `tenantId` (vaultId) later.
      const mockDecodedJob: Omit<JobRequest, 'tenantId'> = {
        resourceType: resourceType,
        action: action,
        input: {
          aud: tenantUrn,
          thid: thid,
          type: 'Employee-creation-request-v1.0',
          body: {
            data: [{ meta: { claims: testClaimsTenant1Receptionist1 } }],
          },
        },
        httpMethod: 'POST',
        fullUrl: registrationUrl, // Use the constructed URL
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
      // Verify the job passed to the queue has the correct, decoded information.
      // This assertion is critical as it proves the controller correctly added the vaultId.
      const queuedJob = (mockQueueAdapter.addJob as jest.Mock).mock
        .calls[0][1] as JobRequest;
      expect(queuedJob).toMatchObject({
        tenantId: expectedVaultId,
        resourceType: resourceType,
        action: action,
      });
      expect(queuedJob.input.thid).toBe(thid);

      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.get('Retry-After')).toBe(EXPECTED_RETRY_AFTER);
      // CORRECTED: A 202 response should have an empty body per FHIR async spec.
      expect(response.body).toEqual({});
    });
  });
});