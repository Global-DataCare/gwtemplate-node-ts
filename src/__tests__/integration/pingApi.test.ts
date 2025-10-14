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
import { decodedPingMessage, testEncryptedJwePing, decodedTenantPingMessage } from '../data/ping.data';
import { testCompletedJob, testPendingJob } from '../data/async-response.data';
import { createDidServiceId } from '../../utils/did';
import { IssueType } from '../../models/fhir/codes';
import { JobRequest } from '../../models/request';
import { DidService } from '../../models/did';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, mockKmsService);

  mockKmsService.init();

  const apiRouter = createApiRouter(mockQueueAdapter, tenantsCacheManager, mockKmsService, asyncResponseStore);
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Ping API Endpoint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const pingServiceConfig: DidService = {
    id: createDidServiceId({ version: 'v1', sector: 'test', section: 'ping', format: 'standard' }),
    type: 'ApiService',
    serviceEndpoint: 'resource',
    actions: ['_batch'],
  };

  describe('POST /host/.../_batch (Host Ping)', () => {
    it('should queue a job for the host and return 202', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Spy on the correct method used by the router for validation
      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue([pingServiceConfig]);
      
      const mockDecodedJob: JobRequest = {
        input: decodedPingMessage,
        meta: {},
        tenantId: 'host',
        resourceType: 'resource',
        action: '_batch',
        sector: 'test',
        section: 'ping',
        format: 'standard'
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob);

      const pingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch';
      const expectedPollingUrl = pingUrl.replace('/_batch', '/_batch-response');

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);
        
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      
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

      jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue([pingServiceConfig]);

      const mockDecodedJob: JobRequest = {
        input: decodedTenantPingMessage,
        meta: {},
        tenantId: 'acme',
        resourceType: 'resource',
        action: '_batch',
        sector: 'test',
        section: 'ping',
        format: 'standard'
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob);
      const pingUrl = '/acme/cds-xx/v1/test/ping/standard/resource/_batch';
      const expectedPollingUrl = pingUrl.replace('/_batch', '/_batch-response');

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwePing}`);

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      expect(jobRequest.tenantId).toBe('test_acme'); // The router resolves the vaultId
    });
  });

  describe('Router Security and Validation', () => {
    it('should return 404 if the tenant service config does not exist', async () => {
        const asyncResponseStore = new AsyncResponseStoreMem();
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
        jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue(undefined);
        const pingUrl = '/nonexistent-tenant/cds-xx/v1/test/ping/standard/resource/_batch';

        const response = await request(app)
          .post(pingUrl)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(`request=${testEncryptedJwePing}`);

        expect(response.status).toBe(404);
        expect(response.body.issue[0].code).toBe(IssueType.NotFound);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });

    it('should return 404 if the service is not in the DID', async () => {
        const asyncResponseStore = new AsyncResponseStoreMem();
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);
        jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockReturnValue([]);
        const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';

        const response = await request(app)
          .post(pingUrl)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(`request=${testEncryptedJwePing}`);

        expect(response.status).toBe(404);
        expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });
    });

  describe('Job Polling (`/_batch-response`)', () => {
    const pollingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch-response';
    const thid = decodedPingMessage.thid;

    it('should return 200 OK with the result if the job is complete', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testCompletedJob);
      const { app } = setupApp(asyncResponseStore);

      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${thid}`);

      expect(response.status).toBe(200);
      expect(response.text).toBe(`response=${testCompletedJob.result}`);
    });

    it('should return 202 Accepted if the job is still pending', async () => {
      const asyncResponseStore = new AsyncResponseStoreMem();
      asyncResponseStore.set(thid, testPendingJob);
      const { app } = setupApp(asyncResponseStore);

      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${thid}`);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('PENDING');
    });
  });
});