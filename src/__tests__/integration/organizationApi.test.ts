// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/integration/organizationApi.test.ts

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { CryptographyService } from '../../crypto/CryptographyService';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import {
  testClaimsTenant1Registration,
} from '../data/end-to-end.data';
import { testHostAlternateName } from '../data/organization.data';
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
import { IServerConfig } from '../../config';
import { Sector } from '../../models/urlPath';
import { HostingManager } from '../../managers/HostingManager';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { testClaimsHostInitialization } from '../data/end-to-end.data';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn((jobName: string, jobData: JobRequest) => Promise.resolve()),
};

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

// Define a reusable setup function to create the app instance
const setupApp = (
  asyncResponseStore: IAsyncResponseStore,
  tenantsCacheManager: TenantsCacheManager,
  vaultRepository: VaultMemRepository,
) => {
  const app = express();
  // Use urlencoded parser for FAPI-compliant form parameter bodies
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json()); // Also add json parser for legacy tests

  const cryptographyService = new CryptographyService();
  // Initialize the mock KMS to simulate the server startup sequence
  mockKmsService.init();

  // Pass the 6 required arguments
  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
  );
  app.use('/', apiRouter);

  return app;
};

describe('Organization Registration API', () => {
  let app: express.Express;
  let tenantsCacheManager: TenantsCacheManager;
  let vaultRepository: VaultMemRepository;
  let asyncResponseStore: IAsyncResponseStore;
  let mockConfig: IServerConfig;

  beforeEach(async () => {
    vaultRepository = new VaultMemRepository();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService);
    asyncResponseStore = new AsyncResponseStoreMem();

    mockConfig = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.TEST],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    const hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockConfig,
    );
    // Bootstrap the host to ensure its services are configured in the tenantsCacheManager
    await hostingManager.bootstrapHost(testClaimsHostInitialization);

    app = setupApp(asyncResponseStore, tenantsCacheManager, vaultRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /host/.../_batch (Job Submission)', () => {
    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      // The app and managers are already set up in beforeEach
      const tenantId = 'host';
      const jurisdiction = 'ES';
      const sector = 'test';
      const section = 'registry';
      const format = 'org.schema';
      const resourceType = 'Organization';
      const action = '_batch';
      const EXPECTED_RETRY_AFTER = '5';

      const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = registrationUrl.replace('/_batch', '/_batch-response');

      const thid = uuidv4();
      const mockDecodedJob: Omit<JobRequest, 'tenantId'> = {
        resourceType: resourceType,
        action: action,
        content: {
          aud: `did:web:${testHostAlternateName}`,
          thid: thid,
          type: 'https://didcomm.org/registration/1.0/register',
          body: { data: [{ meta: { claims: testClaimsTenant1Registration } }] },
          iss: 'did:web:some-issuer',
        },
        meta: {
          jws: {
            protected: {
              alg: 'ML-DSA-44',
              kid: 'did:web:some-issuer#key-1',
            },
          },
          jwe: {
            header: {
              skid: 'did:web:some-issuer#enc-key-1',
              jwk: {
                kty: 'OKP',
                crv: 'ML-KEM-768',
                kid: 'did:web:some-issuer#enc-key-1',
                x: 'mock-public-encryption-key-x',
              },
            },
          },
          bearer: {
            jwt: { payload: { email: 'admin@host.com' } },
          },
        },
      };
      mockKmsService.decodeJobRequest.mockResolvedValue(mockDecodedJob as JobRequest);

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
      // The app and managers are already set up in beforeEach.
      const tenantId = 'tenant1';
      const registrationUrl = `/${tenantId}/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      expect(response.status).toBe(403);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.Forbidden);
      expect(mockQueueAdapter.addJob).not.toHaveBeenCalled();
    });
  });

  describe('POST /host/.../_batch-response (Job Polling)', () => {
    const pollingUrl = '/host/cds-ES/v1/test/registry/org.schema/Organization/_batch-response';

    it('should return 200 OK with the form-encoded JWE if the job is complete', async () => {
      asyncResponseStore.set(testThid1, testCompletedJob);
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${testThid1}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
      // The body is not JSON, so we inspect the raw text of the response.
      expect(response.text).toBe(`response=${testCompletedJob.result}`);
      expect(asyncResponseStore.get(testThid1)).toBeUndefined();
    });

    it('should return 202 Accepted if the job is still pending', async () => {
      asyncResponseStore.set(testThid1, testPendingJob);
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`thid=${testThid1}`);

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('PENDING');
      expect(asyncResponseStore.get(testThid1)).toBeDefined();
    });

    it('should return 404 Not Found for an unknown thid', async () => {
      const response = await request(app)
        .post(pollingUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('thid=unknown-thid');

      expect(response.status).toBe(404);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe(IssueType.NotFound);
    });
  });
});

