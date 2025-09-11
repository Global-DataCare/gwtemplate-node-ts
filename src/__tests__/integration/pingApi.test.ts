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
import { createDidServiceId } from '../../utils/did';
import { DidDocument } from 'src/models/did';

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
          id: 'did:web:antifraud.example.com',
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
          id: 'did:web:antifraud.example.com:tenant1',
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
});
