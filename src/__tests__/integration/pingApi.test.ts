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
import { JobRequest } from '../../models/request';
import { Sector } from '../../models/sector';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  // Add all body parsers needed for the tests
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.json({ type: "application/fhir+json" }));

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, mockKmsService);

  // Initialize the mock KMS to simulate the server startup sequence
  mockKmsService.init();

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
        didConfig: {
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
      
      const mockDecodedJob: JobRequest = {
        input: decodedPingMessage,
        meta: {}, // Mock meta as needed
        tenantId: 'host',
        resourceType: 'resource',
        action: '_batch'
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob)

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
        didConfig: {
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

      const mockDecodedJob: JobRequest = {
        input: decodedTenantPingMessage,
        meta: {}, // Mock meta as needed
        tenantId: 'tenant1',
        resourceType: 'resource',
        action: '_batch'
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob);
      const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';
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

      // Self-documenting assertion: extract arguments by name
      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      expect(jobName).toContain('tenant1:resource');
      expect(jobRequest.tenantId).toBe('tenant1');
    });
  });

  describe('POST /:tenantId/.../_batch (Legacy JSON Ping)', () => {
    it('should queue a job when sent as application/json', async () => {
      // --- Arrange ---
      const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const mockTenantConfig: Partial<TenantConfig> = {
        alternateName: 'tenant1',
        didConfig: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: 'did:web:api.example.com:tenant1',
          service: [{
            id: createDidServiceId({ version: 'v1', sector: 'test', section: 'ping', format: 'standard' }),
            type: 'ApiService', serviceEndpoint: 'resource', actions: ['_batch'],
          }]
        } as DidDocument,
      };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockTenantConfig as TenantConfig);

      const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/json')
        .send(decodedTenantPingMessage);
      // --- Assert ---
      expect(response.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      const [jobName, jobRequest] = mockQueueAdapter.addJob.mock.calls[0];
      expect(jobRequest.input.thid).toBe(decodedTenantPingMessage.thid);
    });

    it('should use the `id` field as a fallback for `thid`', async () => {
        // --- Arrange ---
        const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      const mockTenantConfig: Partial<TenantConfig> = { alternateName: 'tenant1', didConfig: { service: [{ id: createDidServiceId({ version: 'v1', sector: 'test', section: 'ping', format: 'standard' }), type: 'ApiService', serviceEndpoint: 'resource', actions: ['_batch'] }] } as any };
      jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockTenantConfig as TenantConfig);

      const { thid, ...messageWithId } = decodedTenantPingMessage;
      (messageWithId as any).id = 'fallback-id-123';

      const pingUrl = '/tenant1/cds-xx/v1/test/ping/standard/resource/_batch';

        // --- Act ---
        const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/json')
        .send(messageWithId);

        // --- Assert ---
      expect(response.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      const job = asyncResponseStore.get('fallback-id-123');
      expect(job).toBeDefined();
      });
  });

  describe('Router Security and Validation (Explicit Rejection)', () => {
    it('should return 404 if the tenantId does not exist', async () => {
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
      expect(response.status).toBe(404);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.NotFound);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });

    it('should return 404 if the service is not in the DID', async () => {
        // --- Arrange ---
        const asyncResponseStore = new AsyncResponseStoreMem();
      const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

      // Mock a tenant that exists but has NO services configured in its DID document.
      const mockTenantConfig: Partial<TenantConfig> = {
        alternateName: 'tenant1',
        didConfig: {
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
        expect(response.status).toBe(404);
        expect(response.body.resourceType).toBe('OperationOutcome');
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
      });
    });

  describe('Job Polling (`/_batch-response`)', () => {
    const pollingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch-response';
    const thid = decodedPingMessage.thid;

    describe('POST Polling (Default)', () => {
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

    describe('GET Polling (FHIR Conformance)', () => {
      it('should return 200 OK for a FHIR-sector tenant', async () => {
        // --- Arrange ---
        const asyncResponseStore = new AsyncResponseStoreMem();
        asyncResponseStore.set(thid, testCompletedJob);
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

        // Mock a tenant in a FHIR-enabled sector
        const mockFhirTenant: Partial<TenantConfig> = { alternateName: 'fhir_tenant', sector: Sector.HEALTH_CARE };
        jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockFhirTenant as TenantConfig);

        const fhirPollingUrl = `/fhir_tenant/cds-xx/v1/test/ping/standard/resource/_batch-response?thid=${thid}`;

        // --- Act ---
        const response = await request(app).get(fhirPollingUrl);

        // --- Assert ---
        expect(response.status).toBe(200);
        expect(response.text).toBe(`response=${testCompletedJob.result}`);
      });

      it('should return 405 Method Not Allowed for a non-FHIR-sector tenant', async () => {
        // --- Arrange ---
        const asyncResponseStore = new AsyncResponseStoreMem();
        const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

        // Mock a tenant in a non-FHIR sector
        const mockNonFhirTenant: Partial<TenantConfig> = { alternateName: 'non_fhir_tenant', sector: 'test' as Sector};
        jest.spyOn(tenantsCacheManager, 'getConfigByAlternateName').mockResolvedValue(mockNonFhirTenant as TenantConfig);

        const nonFhirPollingUrl = `/non_fhir_tenant/cds-xx/v1/test/ping/standard/resource/_batch-response?thid=${thid}`;

        // --- Act ---
        const response = await request(app).get(nonFhirPollingUrl);

        // --- Assert ---
        expect(response.status).toBe(405);
        expect(response.body.resourceType).toBe('OperationOutcome');
        expect(response.body.issue[0].code).toBe(IssueType.NotSupported);
      });
    });
  });
});