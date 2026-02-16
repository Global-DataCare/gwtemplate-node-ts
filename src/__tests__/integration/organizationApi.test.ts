// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/integration/organizationApi.test.ts

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { createApiRouter } from '../../routes/api';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testClaimsHostInitialization } from '../data/end-to-end.data';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { IServerConfig } from '../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { ILogger } from '../../loggers/ILogger';
import { generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ORGANIZATION_ORDER_REQUEST, ORGANIZATION_REGISTRATION_REQUEST } from '../data/example-payloads';
import { ORGANIZATION_REGISTRATION_JOB } from '../data/example-jobs';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { MlkemPrivateJwk, MlkemPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { createHash } from 'crypto';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { ClaimsOfferSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JWK } from 'gdc-common-utils-ts/models/jwk';
import { HostingManager } from '../../managers/HostingManager';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';

type InMemoryResponse = {
  status: number;
  headers: Record<string, string>;
  text: string;
};

async function invokeExpress(
  handler: any,
  options: { method: string; url: string; headers?: Record<string, string>; body?: any },
): Promise<InMemoryResponse> {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let responseText = '';

  const req = {
    method: options.method.toUpperCase(),
    url: options.url,
    originalUrl: options.url,
    headers: Object.fromEntries(
      Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
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
    location(value: string) {
      headers['location'] = value;
      return this;
    },
    type(value: string) {
      headers['content-type'] = value;
      return this;
    },
    send(payload: any) {
      if (payload === undefined || payload === null) {
        responseText = '';
      } else if (typeof payload === 'string') {
        responseText = payload;
      } else {
        if (!headers['content-type']) headers['content-type'] = 'application/json';
        responseText = JSON.stringify(payload);
      }
      resolveFinished?.();
      return this;
    },
    json(payload: any) {
      headers['content-type'] = 'application/json';
      responseText = JSON.stringify(payload);
      resolveFinished?.();
      return this;
    },
    end(payload?: any) {
      if (payload !== undefined) {
        this.send(payload);
      } else {
        resolveFinished?.();
      }
      return this;
    },
  };

  const handleFn = (typeof handler === 'function' ? handler : handler?.handle) as
    | ((req: any, res: any, next: (err?: any) => void) => void)
    | undefined;
  if (!handleFn) {
    throw new Error('invokeExpress: handler has no handle()');
  }

  handleFn(req, res, (err?: any) => {
    if (err) rejectFinished?.(err);
    else resolveFinished?.();
  });

  await finished;
  return { status: statusCode, headers, text: responseText };
}

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const setupApp = (
  asyncResponseStore: IAsyncResponseStore,
  tenantsCacheManager: TenantsCacheManager,
  vaultRepository: VaultMemRepository,
) => {
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  mockKmsService.init();
  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://host.example.com'
  );
  const app = express();
  app.use('/', apiRouter);
  return app;
};

describe('Organization Registration API', () => {
  let app: express.Express;
  let tenantsCacheManager: TenantsCacheManager;
  let vaultRepository: VaultMemRepository;
  let asyncResponseStore: IAsyncResponseStore;
  let mockConfig: IServerConfig;
  let cryptoService: CryptographyService;
  let externalEncrypter: MlkemPrivateJwk;
  const hostPublicEncKey: MlkemPublicJwk = {
    kty: 'OKP',
    crv: 'ML-KEM-768',
    kid: 'thumbprint-public-enc-key-device',
    x: 'base64url-public-enc-key-device',
  } as MlkemPublicJwk;

  let hostingManager: HostingManager;

  beforeAll(async () => {
    const hostCollectionName = generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    vaultRepository = new VaultMemRepository();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);
    asyncResponseStore = new AsyncResponseStoreMem();

    mockConfig = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'host',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.TEST, Sector.SYSTEM],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' },
      firebase: {},
      allowedPaymentMethods: ['Stripe'],
    };

    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as unknown as JWK] });

    app = setupApp(asyncResponseStore, tenantsCacheManager, vaultRepository);

    cryptoService = new CryptographyService(new AdapterCryptoSdkNode());
    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as JWK] });
    
    const externalClientSeed = 'org-reg-v2-test-seed';
    const dsaSeed = createHash('sha256').update(externalClientSeed + '-dsa').digest().subarray(0, 32);
    const kemSeed = createHash('sha512').update(externalClientSeed + '-kem').digest().subarray(0, 64);
    const signerKeyPair = await cryptoService.generateKeyPairMlDsa(dsaSeed);
    const encrypterKeyPair = await cryptoService.generateKeyPairMlKem(kemSeed);
    externalEncrypter = { ...encrypterKeyPair.publicJWKey, dBytes: encrypterKeyPair.secretKeyBytes };
    mockKmsService.encodeResponse.mockImplementation(async (payload) =>
      cryptoService.encryptJweToCompact(payload, { cty: 'application/api+json' }, externalEncrypter, externalEncrypter),
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (asyncResponseStore as AsyncResponseStoreMem).clear();
    (vaultRepository as VaultMemRepository).clear();

    // Re-bootstrap the host before each test to ensure a clean state
    // Mocks for dependencies used by HostingManager
    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockImplementation(async () => ({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    }));

    mockKmsService.getHostPublicJwkSet.mockResolvedValue({ keys: [hostPublicEncKey as unknown as JWK] });
    mockKmsService.encodeResponse.mockImplementation(async (payload) =>
      cryptoService.encryptJweToCompact(payload, { cty: 'application/api+json' }, externalEncrypter, externalEncrypter),
    );

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantsCacheManager.loadHost();
  });

  afterAll(async () => {
    jest.clearAllMocks();
  });

  describe('POST /host/.../_batch (Job Submission)', () => {
    it('should decode the request, queue a job, and return 202 Accepted', async () => {
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;
      const expectedPollingUrl = `http://host.example.com${registrationUrl.replace('/_batch', '/_batch-response')}`;
      // In this test, we only care that the job is queued. We don't need a valid decoded job.
      mockKmsService.decodeRequest.mockResolvedValue({
        ...ORGANIZATION_REGISTRATION_JOB,
        content: ORGANIZATION_REGISTRATION_REQUEST
      } as any);

      const response = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: testEncryptedJwe1 },
      });

      expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(testEncryptedJwe1);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      const queuedJob = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0][1] as JobRequest;
      expect(queuedJob.tenantId).toBe(ORGANIZATION_REGISTRATION_JOB.tenantId);
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
    });
  });

  describe('Organization Registration v2 (Offer/Order Flow)', () => {
    it('should accept a registration request and return a verifiable Offer', async () => {
      const orgCreationPayload = { ...ORGANIZATION_REGISTRATION_REQUEST };
      const { thid } = orgCreationPayload;

      // The controller calls decodeRequest. We mock its output to be the job for the manager.
      const decodedJobForManager: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB,
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orgCreationPayload,
      };
      mockKmsService.decodeRequest.mockResolvedValue(decodedJobForManager);

      // The router queues the job. We'll capture it to simulate the worker processing it later.
      let capturedJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementation(async (jobName, jobData) => {
        capturedJob = jobData;
      });

      const compactJwe = "fake.encrypted.payload"; // This can be fake as decodeRequest is mocked
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;
      
      // --- ACT (Phase 1) ---
      const postResponse = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: compactJwe },
      });

      // --- ASSERT (Phase 1) ---
      expect(postResponse.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
      expect(capturedJob).toBeDefined();

      // --- ACT (Phase 2: Simulate Worker) ---
      // Now, we simulate the worker picking up the job and processing it.
      // The hostingManager is now initialized in beforeEach.
      const workerResultPayload = await hostingManager.process(capturedJob!);
      const encryptedWorkerResult = await mockKmsService.encodeResponse(workerResultPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(thid, { status: 'COMPLETED', result: encryptedWorkerResult });

      // --- ACT (Phase 3: Polling) ---
      const pollingUrl = postResponse.headers.location;
      const pollingPath = new URL(pollingUrl).pathname;
      const pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid },
      });

      // --- ASSERT (Phase 3) ---
      expect(pollResponse.status).toBe(200);
      const encryptedFinalResponse = pollResponse.text.replace('response=', '');
      const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
      const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;

      const responseEntry = finalResponse.body.data[0];
      const responseClaims = responseEntry.meta.claims;

      expect(responseEntry.type).toBe('Organization-registration-offer-v1.0');
      expect(responseClaims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(2);
      expect(responseClaims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(responseClaims[ClaimsOfferSchemaorg.offeredBy]).toBe('did:web:host.example.com');
    });

    it('should process an Order and return a payment Communication', async () => {
      // --- ARRANGE (Phase 1: Initial Registration & Offer) ---
      const orgCreationPayload = { ...ORGANIZATION_REGISTRATION_REQUEST };
      const { thid: regThid } = orgCreationPayload;
      const registrationUrl = `/host/cds-es/v1/test/registry/org.schema/Organization/_batch`;

      const decodedRegJob: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB,
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orgCreationPayload,
      };
      mockKmsService.decodeRequest.mockResolvedValueOnce(decodedRegJob);

      let capturedRegJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementationOnce(async (jobName, jobData) => {
        capturedRegJob = jobData;
      });

      const regPostResponse = await invokeExpress(app, {
        method: 'POST',
        url: registrationUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'fake-jwe' },
      });
      
      const offerPayload = await hostingManager.process(capturedRegJob!);
      const encryptedOffer = await mockKmsService.encodeResponse(offerPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(regThid, { status: 'COMPLETED', result: encryptedOffer });
      
      const pollingUrl = regPostResponse.headers.location;
      const pollingPath = new URL(pollingUrl).pathname;
      const pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid: regThid },
      });

      const encryptedOfferResponse = pollResponse.text.replace('response=', '');
      const { decryptedBytes: decryptedOfferBytes } = await cryptoService.decryptJwe(encryptedOfferResponse, externalEncrypter);
      const offerResponse = JSON.parse(Content.bytesToStringUTF8(decryptedOfferBytes)) as IDecodedDidcommPayload;
      const offerClaims = offerResponse.body.data[0].meta.claims;
      const offerId = offerClaims[ClaimsOfferSchemaorg.identifier] as string;
      expect(offerId).toBeDefined();

      // --- ACT (Phase 2: Submit Order) ---
      const orderPayload = { ...ORGANIZATION_ORDER_REQUEST };
      orderPayload.body.data[0].meta.claims['Order.acceptedOffer.identifier'] = offerId;
      const { thid: orderThid } = orderPayload;
      
      const decodedOrderJob: JobRequest = {
        ...ORGANIZATION_REGISTRATION_JOB, // Re-using for structure, but with Order content
        resourceType: 'Order',
        id: uuidv4(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: orderPayload,
      };
      // For this test we bypass orchestrator signature resolution by embedding a JWK,
      // matching the "full JWK" path used during initial registration.
      (decodedOrderJob.content as any).meta = (decodedOrderJob.content as any).meta || {};
      (decodedOrderJob.content as any).meta.jwe = (decodedOrderJob.content as any).meta.jwe || { header: {} };
      (decodedOrderJob.content as any).meta.jwe.header = (decodedOrderJob.content as any).meta.jwe.header || {};
      (decodedOrderJob.content as any).meta.jwe.header.jwk = hostPublicEncKey as unknown as JWK;
      mockKmsService.decodeRequest.mockResolvedValueOnce(decodedOrderJob);

      let capturedOrderJob: JobRequest | undefined;
      mockQueueAdapter.addJob.mockImplementationOnce(async (jobName, jobData) => {
        capturedOrderJob = jobData;
      });
      
      const orderUrl = `/host/cds-es/v1/test/registry/org.schema/Order/_batch`;
      const orderPostResponse = await invokeExpress(app, {
        method: 'POST',
        url: orderUrl,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { request: 'fake-jwe-order' },
      });

      // --- ASSERT (Phase 2: Order Submission) ---
      expect(orderPostResponse.status).toBe(202);
      expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(2);
      expect(capturedOrderJob).toBeDefined();

      // --- ACT (Phase 3: Simulate Worker on Order & Poll) ---
      const finalResultPayload = await hostingManager.process(capturedOrderJob!);
      const encryptedFinalResult = await mockKmsService.encodeResponse(finalResultPayload, [externalEncrypter as unknown as JWK], 'host');
      await asyncResponseStore.set(orderThid, { status: 'COMPLETED', result: encryptedFinalResult });

      const orderPollingUrl = orderPostResponse.headers.location;
      const orderPollingPath = new URL(orderPollingUrl).pathname;
      const finalPollResponse = await invokeExpress(app, {
        method: 'POST',
        url: orderPollingPath,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'App-ID': 'test-app',
          'App-Version': '1.0.0',
          Authorization: 'Bearer fake-oidc-id-token',
        },
        body: { thid: orderThid },
      });
      
      // --- ASSERT (Phase 3: Final VC) ---
      expect(finalPollResponse.status).toBe(200);
      const encryptedFinalVc = finalPollResponse.text.replace('response=', '');
      const { decryptedBytes: decryptedVcBytes } = await cryptoService.decryptJwe(encryptedFinalVc, externalEncrypter);
      const finalVcResponse = JSON.parse(Content.bytesToStringUTF8(decryptedVcBytes)) as IDecodedDidcommPayload;

      const responseEntry = finalVcResponse.body.data[0];
      expect(responseEntry.type).toBe('Organization-order-response-v1.0');
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.meta?.claims['org.schema.Order.acceptedOffer.identifier']).toBe(offerId);
    });
  });
});
