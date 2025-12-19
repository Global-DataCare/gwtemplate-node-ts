// src/__tests__/integration/individual/family.test.ts

import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { CryptographyService } from '../../../crypto/CryptographyService';
import { mockKmsService } from '../../mocks/kms.mock';
import { HostingManager } from '../../../managers/HostingManager';
import { Sector } from '../../../models/urlPath';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { ORGANIZATION_ORDER_JOB, ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import { ClaimsOfferSchemaorg } from '../../../models/schemaorg';
import { FAMILY_REGISTRATION_REQUEST } from '../../data/example-payloads';
import { JobRequest, JobStatus } from '../../../models/confidential-job';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';

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

describe('[/individual/org.schema/Organization/_batch] Integration Tests (sandbox-safe)', () => {
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

    // Create and finalize the provider tenant so the API path validator allows `individual/org.schema/Organization`.
    const regJob = { ...ORGANIZATION_REGISTRATION_JOB };
    const offerPayload = await hostingManager.process(regJob);
    const offerId = offerPayload.body.data[0].meta.claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderJob = { ...ORGANIZATION_ORDER_JOB };
    orderJob.content!.body!.data[0]!.meta!.claims['Order.acceptedOffer.identifier'] = offerId;
    await hostingManager.process(orderJob);

    const asyncResponseStore = new AsyncResponseStoreMem();
    const crypto = new CryptographyService();
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

  it('should return 202 Accepted for a valid family registration request', async () => {
    const tenantId = 'acme';
    const url = `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_batch`;

    const decodedJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      action: '_batch',
      resourceType: 'Organization',
      content: FAMILY_REGISTRATION_REQUEST as any,
    };
    mockKmsService.decodeRequest.mockResolvedValueOnce(decodedJob as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'App-ID': 'test-app',
        'App-Version': '1.0.0',
        Authorization: 'Bearer fake-oidc-id-token',
      },
      body: { request: 'fake.encrypted.payload' },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(response.headers.location).toContain(`${url.replace('/_batch', '/_batch-response')}`);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
  });
});
