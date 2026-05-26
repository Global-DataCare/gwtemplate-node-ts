// src/__tests__/integration/individual/family.multiphone.test.ts
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

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
import { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg, ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { testDefaultTenantServiceTypeClaim, testTenant1TenantId } from '../../data/organization.data';

async function invokeExpress(
  handler: any,
  options: { method: string; url: string; headers?: Record<string, string>; body?: any },
): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseText = '';

  const req = {
    method: options.method.toUpperCase(),
    url: options.url,
    originalUrl: options.url,
    headers: Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
    body: options.body,
    query: {},
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
  };

  let resolveFinished: (() => void) | undefined;
  let rejectFinished: ((err: any) => void) | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    setHeader(field: string, value: string) {
      headers[field.toLowerCase()] = value;
      return this;
    },
    getHeader(field: string) {
      return headers[field.toLowerCase()];
    },
    removeHeader(field: string) {
      delete headers[field.toLowerCase()];
    },
    location(value: string) {
      headers['location'] = value;
      return this;
    },
    json(payload: any) {
      headers['content-type'] = 'application/json';
      responseText = JSON.stringify(payload);
      resolveFinished?.();
      return this;
    },
    send(payload?: any) {
      responseText = typeof payload === 'string' ? payload : '';
      resolveFinished?.();
      return this;
    },
    end() {
      resolveFinished?.();
      return this;
    },
  };

  const handleFn = (typeof handler === 'function' ? handler : handler?.handle) as
    | ((req: any, res: any, next: (err?: any) => void) => void)
    | undefined;
  if (!handleFn) throw new Error('invokeExpress: handler has no handle()');

  handleFn(req, res, (err?: any) => {
    if (err) rejectFinished?.(err);
    else resolveFinished?.();
  });

  await finished;
  return { status: statusCode, headers, text: responseText };
}

describe('FamilyManager multi-phone integration', () => {
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

  it('should create two organizations with same owner (multi-phone) and recover one by apodo and phone', async () => {
    const tenantId = testTenant1TenantId;
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

    // Org 1: apodo "FAMILIA-UNO", phones: "+34600000001,+34600000002"
    // Org 2: apodo "FAMILIA-DOS", phones: "+34600000001,+34600000003"
    const org1Phones = '+34600000001,+34600000002';
    const org2Phones = '+34600000001,+34600000003';
    const individualNickname1 = 'FAMILIA-UNO';
    const individualNickname2 = 'FAMILIA-DOS';

    const baseClaims = {
      'org.schema.Organization.owner.telephone': org1Phones,
      'org.schema.Organization.owner.email': 'parent@example.com',
      'org.schema.Organization.owner.identifier.value': 'parent@example.com',
      'org.schema.Organization.alternateName': individualNickname1,
      'org.schema.Service.identifier': 'did:web:provider.example.com',
      'org.schema.Service.serviceType': testDefaultTenantServiceTypeClaim,
      'org.schema.Service.category': 'health-care',
      'org.schema.Organization.addressCountry': 'ES',
    };
    const baseClaims2 = {
      ...baseClaims,
      'org.schema.Organization.owner.telephone': org2Phones,
      'org.schema.Organization.alternateName': individualNickname2,
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
        iss: 'did:web:client.example.com',
        aud: `did:web:${tenantId}.example.com`,
        jti: 'jti-dos',
        thid: 'thid-dos',
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

    // Buscar org2 por owner.telephone y alternateName
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
              'org.schema.Organization.owner.telephone': '+34600000003',
              'org.schema.Organization.alternateName': individualNickname2,
              'org.schema.Service.category': 'health-care',
            } },
          }],
        },
      },
    };
    const searchResult = await hostingManager.process(searchJob);
    const found = searchResult.body.data[0];
    expect(found.meta.claims['org.schema.Organization.alternateName']).toBe(individualNickname2);
    expect(found.meta.claims['org.schema.Organization.owner.telephone']).toContain('+34600000003');
    expect(found.meta.claims['org.schema.FamilyRegistration.status']).toBe('already_exists');
  });
});
