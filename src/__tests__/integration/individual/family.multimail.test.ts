import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { mockKmsService } from '../../mocks/kms.mock';
import { HostingManager } from '../../../managers/HostingManager';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';

describe('FamilyManager multi-email integration (web/app)', () => {
  const mockQueueAdapter = { addJob: jest.fn() };
  const mockStorageAdapter: jest.Mocked<IStorageAdapter> = { upload: jest.fn() };
  const mockLogger: jest.Mocked<ILogger> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  let app: express.Express;
  let vaultRepository: VaultMemRepository;
  let tenantsCacheManager: TenantsCacheManager;
  let hostingManager: HostingManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    vaultRepository = new VaultMemRepository();
    const hostCollectionName = generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);

    const config = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'host',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.TEST],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' },
      firebase: {},
    } as any;

    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    });

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
    );

    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantsCacheManager.loadHost();

    const asyncResponseStore = new AsyncResponseStoreMem();
    const crypto = new CryptographyService(new AdapterCryptoSdkNode());
    const apiRouter = createApiRouter(
      mockQueueAdapter as any,
      tenantsCacheManager,
      mockKmsService,
      asyncResponseStore,
      vaultRepository,
      crypto,
      'http://host.example.com',
    );

    app = express();
    app.use('/', apiRouter);
  });

  it('should create two organizations with same owner (multi-email) and recover one by apodo and email', async () => {
    const tenantId = 'acme';
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

    // Org 1: apodo "FAMILIA-UNO", emails: "parent1@example.com,parent2@example.com"
    // Org 2: apodo "FAMILIA-DOS", emails: "parent1@example.com,parent3@example.com"
    const org1Emails = 'parent1@example.com,parent2@example.com';
    const org2Emails = 'parent1@example.com,parent3@example.com';
    const ownerName1 = 'FAMILIA-UNO';
    const ownerName2 = 'FAMILIA-DOS';

    const baseClaims = {
      'org.schema.Organization.owner.telephone': '+34600000001',
      'org.schema.Organization.owner.email': org1Emails,
      'org.schema.Organization.owner.identifier.value': 'parent1@example.com',
      'org.schema.Organization.alternateName': ownerName1,
      'org.schema.Service.identifier': 'did:web:provider.example.com',
      'org.schema.Service.serviceType': 'http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC',
      'org.schema.Service.category': 'health-care',
      'org.schema.Organization.addressCountry': 'ES',
    };
    const baseClaims2 = {
      ...baseClaims,
      'org.schema.Organization.owner.email': org2Emails,
      'org.schema.Organization.alternateName': ownerName2,
    };

    // Create org1

    const job1: JobRequest = {
      id: 'job-family-uno',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: {
        jti: 'jti-uno',
        thid: 'thid-uno',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            meta: { claims: baseClaims },
          }],
        },
      },
    };
    await hostingManager.process(job1);

    // Create org2
    const job2: JobRequest = {
      ...job1,
      id: 'job-family-dos',
      content: {
        ...job1.content,
        jti: 'jti-dos',
        thid: 'thid-dos',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            meta: { claims: baseClaims2 },
          }],
        },
      },
    };
    await hostingManager.process(job2);

    // Buscar org2 por owner.email y alternateName
    const searchJob: JobRequest = {
      id: 'job-search',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Organization',
      content: {
        jti: 'jti-search',
        thid: 'thid-search',
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        type: 'application/api+json',
        body: {
          data: [{
            type: 'Family-registration-form-v1.0',
            meta: { claims: {
              'org.schema.Organization.owner.email': 'parent3@example.com',
              'org.schema.Organization.alternateName': ownerName2,
              'org.schema.Service.category': 'health-care',
            } },
          }],
        },
      },
    };
    const searchResult = await hostingManager.process(searchJob);
    const found = searchResult.body.data[0];
    expect(found.meta.claims['org.schema.Organization.alternateName']).toBe(ownerName2);
    expect(found.meta.claims['org.schema.Organization.owner.email']).toContain('parent3@example.com');
    expect(found.meta.claims['org.schema.FamilyRegistration.status']).toBe('already_exists');
  });
});
