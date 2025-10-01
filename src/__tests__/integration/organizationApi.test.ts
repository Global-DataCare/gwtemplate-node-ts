// src/__tests__/integration/organizationApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import {
  testClaimsTenant1Registration,
  testHostData,
} from '../data/end-to-end.data';
import {
  testThid1,
  testCompletedJob,
  testPendingJob,
  testEncryptedJwe1,
} from '../data/async-response.data';
import { JobRequest } from '../../models/request';
import { DidService } from '../../models/did';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import {
  AsyncResponseStoreMem,
  IAsyncResponseStore,
} from '../../adapters/async-response-store.mem';
import { IssueType } from '../../models/fhir/codes';
import { createDidServiceId } from '../../utils/did';

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
  // Use urlencoded parser for FAPI-compliant form parameter bodies
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json()); // Also add json parser for legacy tests

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(
    vaultRepository,
    mockKmsService,
  );

  // Initialize the mock KMS to simulate the server startup sequence
  mockKmsService.init();

  // Pass the 4 required arguments
  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Organization Registration API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /host/.../_batch (Job Submission)', () => {
    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // --- 1. Define constants for URL parameters and expected values ---
      const tenantId = 'host';
      const jurisdiction = 'ES';
      const sector = 'test';
      const section = 'registry';
      const format = 'org.schema';
      const resourceType = 'Organization';
      const action = '_batch';
      const EXPECTED_RETRY_AFTER = '5';

      // --- 2. Programmatically build URLs from constants ---
      const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = registrationUrl.replace(
        '/_batch',
        '/_batch-response',
      );

      // --- 3. Configure Mocks using the constants ---
      // CORRECTED: The router now uses getDidServiceConfig for validation.
      const mockHostServices: DidService[] = [
        {
          id: createDidServiceId({ version: 'v1', sector, section, format }),
          type: 'RegistryService',
          serviceEndpoint: resourceType,
          actions: [action],
        },
      ];
      jest
        .spyOn(tenantsCacheManager, 'getDidServiceConfig')
        .mockReturnValue(mockHostServices);

      const thid = uuidv4();
      const mockDecodedJob: Omit<JobRequest, 'tenantId'> = {
        resourceType: resourceType,
        action: action,
        input: {
          aud: `did:web:${testHostData.alternateName}`,
          thid: thid,
          type: 'https://didcomm.org/registration/1.0/register',
          body: { data: [{ meta: { claims: testClaimsTenant1Registration } }] },
        },
        meta: {},
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

      // Verify the controller added the correct tenantId before queueing.
      const queuedJob = (mockQueueAdapter.addJob as jest.Mock).mock
        .calls[0][1] as JobRequest;
      expect(queuedJob.tenantId).toBe(tenantId);

      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.get('Retry-After')).toBe(EXPECTED_RETRY_AFTER);
      expect(response.body).toEqual({}); // Body should be empty
    });

    it('should return 403 Forbidden if a non-host tenant tries to access the registry', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app } = setupApp(asyncResponseStore);

      const tenantId = 'tenant1';
      // This URL correctly targets the 'registry' section with a non-host tenant.
      const registrationUrl = `/${tenantId}/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

      // --- Act ---
      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      // The controller should identify this as a forbidden action before checking for services.
      expect(response.status).toBe(403);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.Forbidden);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /host/.../_batch-response (Job Polling)', () => {
    // Re-use constants for the polling URL
    const pollingUrl =
      '/host/cds-ES/v1/test/registry/org.schema/Organization/_batch-response';

    it('should return 200 OK with the form-encoded JWE if the job is complete', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(testThid1, testCompletedJob);
      const { app } = setupApp(asyncResponseStore);

      // --- Act ---
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${testThid1}`);

      // --- Assert ---
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(
        /application\/x-www-form-urlencoded/,
      );
      expect(response.text).toBe(`response=${testCompletedJob.result}`);
      expect(asyncResponseStore.get(testThid1)).toBeUndefined();
    });

    it('should return 202 Accepted if the job is still pending', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(testThid1, testPendingJob);
      const { app } = setupApp(asyncResponseStore);

      // --- Act ---
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${testThid1}`);

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body.status).toBe('PENDING');
      expect(asyncResponseStore.get(testThid1)).toBeDefined();
    });

    it('should return 404 Not Found for an unknown thid', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app } = setupApp(asyncResponseStore);

      // --- Act ---
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('thid=unknown-thid');

      // --- Assert ---
      expect(response.status).toBe(404);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.NotFound);
    });
  });
});

