// src/__tests__/integration/pingApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { TenantConfig } from '../../models/tenant';
import { decodedPingMessage, testEncryptedJwePing, decodedTenantPingMessage } from '../data/ping.data';
import { testCompletedJob, testPendingJob } from '../data/async-response.data';
import { createDidServiceId } from '../../utils/did';
import { DidDocument } from '../../models/did';
import { IssueType } from '../../models/fhir/codes';
import { config } from '../../config';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository);

  // The API router only needs these 4 core dependencies.
  const apiRouter = createApiRouter(mockQueueAdapter, tenantsCacheManager, mockKmsService, asyncResponseStore);
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Ping API Endpoint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /host/.../_batch (Host Ping)', () => {
    it('should queue a job for the host and return 202', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Mock the host config with a valid service endpoint for ping
      const mockHostConfig: Partial<TenantConfig> = {
        alternateName: 'host',
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:api.example.com',
          service: [{
            id: createDidServiceId({ version: 'v1', sector: 'test', section: 'ping', format: 'standard' }),
            type: 'ApiService',
            serviceEndpoint: 'resource', // The resourceType allowed
            actions: ['_batch'],         // The action allowed
          }]
        } as DidDocument,
      };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockHostConfig as TenantConfig);
      
      mockKmsService.decodeRequest.mockResolvedValue(decodedPingMessage);
      const pingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch';

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);
        
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body.thid).toBe(decodedPingMessage.thid);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      
      // Self-documenting assertion: extract arguments by name
      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      expect(jobName).toContain('host:resource');
      expect(jobRequest.tenantId).toBe('host');
    });
  });

  describe('POST /:tenantId/.../_batch (Tenant Ping)', () => {
    it('should queue a job for a valid tenant and return 202', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Mock the tenant's existence with a valid service endpoint for ping
      const mockTenantConfig: Partial<TenantConfig> = {
        alternateName: 'tenant1',
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:api.example.com:tenant1',
          service: [{
            id: createDidServiceId({ version: 'v1', sector: 'test', section: 'ping', format: 'standard' }),
            type: 'ApiService',
            serviceEndpoint: 'resource', // The resourceType allowed
            actions: ['_batch'],         // The action allowed
          }]
        } as DidDocument,
      };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockTenantConfig as TenantConfig);

      mockKmsService.decodeRequest.mockResolvedValue(decodedTenantPingMessage);
      const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body.thid).toBe(decodedTenantPingMessage.thid);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      // Self-documenting assertion: extract arguments by name
      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      expect(jobName).toContain('tenant1:resource');
      expect(jobRequest.tenantId).toBe('tenant1');
    });
  });


  describe('Router Security and Validation (Opaque Acceptance)', () => {
    it('should return 202 but not queue a job if the tenantId does not exist', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Mock the tenant manager to find no tenant
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(null);

      const pingUrl = '/nonexistent-tenant/cds-xx/v1/test/ping/standard/resource/_batch';

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);
        
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body).toEqual({}); // Body should be empty
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });

    it('should return 202 but not queue a job if the service is not in the DID', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Mock a tenant that exists but has NO services configured in its DID document.
      const mockTenantConfig: Partial<TenantConfig> = {
        alternateName: 'tenant1',
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:api.example.com:tenant1',
          service: [] // Empty service list confirms no valid service endpoint
        } as DidDocument,
      };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockTenantConfig as TenantConfig);

      const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';
      
      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);
        
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body).toEqual({});
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });

    // NOTE: The other security tests for resourceType, action, and sector are omitted
    // because they follow the exact same pattern as the two tests above. The logic
    // is centralized in `isRequestValid`, and testing all failure paths of that
    // function is better suited for a unit test of `isRequestValid` itself.
    // These integration tests sufficiently prove that the router correctly implements
    // the opaque acceptance pattern when `isRequestValid` returns false.
  });

  describe('POST /host/.../_search (Job Polling)', () => {
    const pollingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_search';
    const thid = decodedPingMessage.thid;
    it('should return 200 OK with the result if the job is complete', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testCompletedJob);
      const { app } = setupApp(asyncResponseStore);

      // --- Act ---
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${thid}`);

      // --- Assert ---
      expect(response.status).toBe(200);
      expect(response.text).toBe(`response=${testCompletedJob.result}`);
      // The store should delete the result after it's retrieved
      expect(asyncResponseStore.get(thid)).toBeUndefined();
    });

    it('should return 202 Accepted if the job is still pending', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testPendingJob);
      const { app } = setupApp(asyncResponseStore);

      // --- Act ---
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${thid}`);

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.body.status).toBe('PENDING');
      // The store should NOT delete the result if it's still pending
      expect(asyncResponseStore.get(thid)).toBeDefined();
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

