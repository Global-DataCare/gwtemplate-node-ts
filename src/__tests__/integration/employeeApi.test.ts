// src/__tests__/integration/employeeApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApiRouter } from '../../routes/api';
import { CryptographyService } from '../../crypto/CryptographyService';
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
import { DidService } from '../../models/did';
import { createDidServiceId } from '../../utils/did';
import { createOrganizationUrn } from '../../utils/urn';
import { getTenantVaultId } from '../../utils/tenant';
import { OrganizationUrnParams } from '../../models/entity';
import { testTenant1AlternateName, testTenant1IdType, testTenant1IdValue } from '../data/organization.data';

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
  const cryptographyService = new CryptographyService();
  // We need a real TenantsCacheManager for routing, but we will mock its return values in tests.
  const tenantsCacheManager = new TenantsCacheManager(
    vaultRepository,
    () => mockKmsService,
    'test-host-collection',
  );

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://localhost:3001',
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
      const tenantId = testTenant1AlternateName; // "acme"
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
      const expectedPollingUrl = `http://localhost:3001${registrationUrl.replace(
        '/_batch',
        '/_batch-response',
      )}`;

      const organizationUrnParams: OrganizationUrnParams = {
        namespace: 'antifraud',
        network: 'test-network',
        jurisdiction: jurisdiction,
        sector: sector,
        idType: testTenant1IdType,
        idValue: testTenant1IdValue,
      }
      const tenantUrn = createOrganizationUrn(organizationUrnParams);

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
        .mockResolvedValue(mockTenantServices);

      jest.spyOn(tenantsCacheManager, 'getTenantIdentifierUrn').mockResolvedValue(tenantUrn);

      const thid = uuidv4();
      // CORRECTED: The mock for the decoded job should represent the raw data from the KMS.
      // The API controller is responsible for adding the canonical `tenantId` (vaultId) later.
      const mockDecodedJob: Omit<JobRequest, 'tenantId'> = {
        resourceType: resourceType,
        action: action,
        content: {
          aud: tenantUrn,
          thid: thid,
          iss: 'did:web:some-issuer',
          type: 'Employee-creation-request-v1.0',
          body: {
            data: [{ meta: { claims: testClaimsTenant1Receptionist1 } }],
          },
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
              jwk: { kty: 'OKP', crv: 'ML-KEM-768', kid: 'did:web:some-issuer#enc-key-1', x: 'mock-key' }
            }
          },
        },
        httpMethod: 'POST',
        requestUrl: registrationUrl, // Use the constructed URL
      };
      mockKmsService.decodeRequest.mockResolvedValue(
        mockDecodedJob as JobRequest,
      );

      // --- Act ---
      const response = await request(app)
        .post(registrationUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(
        testEncryptedJwe1,
      );

      // We only need to confirm that a job was queued. The detailed mechanics of job creation
      // (like job name formatting and parameter passing) are tested exhaustively in `pingApi.test.ts`.
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      expect(response.get('Retry-After')).toBe(EXPECTED_RETRY_AFTER);
      expect(response.body).toEqual({});
    });
  });
});