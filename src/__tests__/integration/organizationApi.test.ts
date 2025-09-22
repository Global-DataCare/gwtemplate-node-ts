// src/__tests__/integration/organizationApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testClaimsTenant1Registration, testHostData } from '../data/organization.data';
import { testThid1, testCompletedJob, testPendingJob, testEncryptedJwe1 } from '../data/async-response.data';
import { TenantConfig } from '../../models/tenant';
import { createDidServiceId } from '../../utils/did';
import { DecodedDidcommMessage, JobRequest } from '../../models/request';
import { DidDocument } from '../../models/did';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { IssueType } from '../../models/fhir/codes';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  // Use urlencoded parser for FAPI-compliant form parameter bodies
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json()); // Also add json parser for legacy tests
  
  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository);
  
  // Pass the 4 required arguments
  const apiRouter = createApiRouter(mockQueueAdapter, tenantsCacheManager, mockKmsService, asyncResponseStore);
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
      
      const hostConfig: Partial<TenantConfig> = {
          ...testHostData,
          didDocument: {
            '@context': 'https://www.w3.org/ns/did/v1',
            id: `did:web:${testHostData.alternateName}`,
          service: [
            {
              id: createDidServiceId({ version: 'v1', sector: 'test', section: 'registry', format: 'org.schema' }),
              type: 'RegistryService',
              serviceEndpoint: 'Organization',
              actions: ['_batch'],
            },
          ],
        } as DidDocument,
      };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(hostConfig as TenantConfig);

      // FIX: The mock must return a complete JobRequest object
      const mockDecodedJob: JobRequest = {
        tenantId: 'host', // The tenant context of the request
        resourceType: 'Organization',
        action: '_batch',
        input: {
          aud: `did:web:${testHostData.alternateName}`,
          thid: uuidv4(),
          type: 'https://didcomm.org/registration/1.0/register',
          body: { data: [{ meta: { claims: testClaimsTenant1Registration } }] },
        },
        meta: {} // Add meta property
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob);
      
      const registrationUrl = '/host/cds-ES/v1/test/registry/org.schema/Organization/_batch';
      const expectedPollingUrl = '/host/cds-ES/v1/test/registry/org.schema/Organization/_batch-response';

      // --- Act ---
      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(mockKmsService.decodeJobRequest).toHaveBeenCalledWith(testEncryptedJwe1);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.body).toEqual({}); // Body should be empty
    });

    it('should return 403 Forbidden if a non-host tenant tries to access the registry', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
      
      // Mock the existence of the tenant trying to access the registry
      const mockTenantConfig: Partial<TenantConfig> = { alternateName: 'tenant1' };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockTenantConfig as TenantConfig);
      
      // The URL attempts to access the 'registry' section using a tenant ID
      const registrationUrl = '/tenant1/cds-ES/v1/test/registry/org.schema/Organization/_batch';

      // --- Act ---
      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(response.status).toBe(403);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.Forbidden);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /host/.../_batch-response (Job Polling)', () => {
    const pollingUrl = '/host/cds-ES/v1/test/registry/org.schema/Organization/_batch-response';

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
      expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
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

