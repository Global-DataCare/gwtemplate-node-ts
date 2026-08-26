import * as express from 'express';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { StorageMemAdapter } from '../../database/storage/mem.storage.adapter';
import { HostingManager } from '../../managers/HostingManager';
import { EmployeeManager } from '../../managers/EmployeeManager';
import { LicenseManager } from '../../managers/LicenseManager';
import { ManagerRegistry } from '../../managers/registry';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';
import { createApiRouter } from '../../routes/api';
import { KmsService } from '../../services/KmsService';
import { InMemoryEnvelopeAdapter } from '../../services/kms-envelope-adapter';
import { VaultWrappedKeyRepository } from '../../services/wrapped-key-repository';
import { Worker } from '../../worker';
import type { IServerConfig } from '../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { invokeExpress } from './helpers/invokeExpress';
import { buildActivationPayload, pollJsonBody } from './helpers/story-flow';
import { ORGANIZATION_ORDER_REQUEST, EMPLOYEE_REGISTRATION_REQUEST } from '../data/example-payloads';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { IHostRuntime } from '../../managers/IHostRuntime';
import { testClaimsHostInitialization } from '../data/end-to-end.data';

const hostBootstrapClaims = testClaimsHostInitialization;

describe('Tenant KMS rehydration after activate route story', () => {
  const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims);
  const vaultRepository = new VaultMemRepository();
  const logger = new ConsoleLogger();
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());

  let initialHarness: Awaited<ReturnType<typeof buildHarness>>;
  let restartedHarness: Awaited<ReturnType<typeof buildHarness>>;
  let tenantId: string;

  beforeAll(async () => {
    process.env.DEV_SEED = 'true';
    process.env.NODE_ENV = 'development';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.FHIR_LEGACY = 'true';
    process.env.DIDCOMM_PLAIN = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    initialHarness = await buildHarness(vaultRepository, hostCollectionName, cryptographyService, logger);
    tenantId = await onboardViaActivateAndOrder(initialHarness.app, initialHarness.queueAdapter);
    await initialHarness.queueAdapter.waitForEmptyQueue();
    initialHarness.queueAdapter.stop();

    restartedHarness = await buildHarness(vaultRepository, hostCollectionName, cryptographyService, logger);
  });

  afterAll(() => {
    initialHarness?.queueAdapter.stop();
    restartedHarness?.queueAdapter.stop();
  });

  it('keeps the published tenant key and employee flow working when provisioning is replayed after restart', async () => {
    const tenantVaultId = getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const publishedDid = await restartedHarness.tenantManager.getDidDocument(tenantVaultId);
    const publishedEncryptionKid = (publishedDid?.verificationMethod || [])
      .find((method) => (method.publicKeyJwk as any)?.use === 'enc')?.publicKeyJwk?.kid;

    const replayedKeys = await restartedHarness.kmsService.provisionKeys(tenantVaultId);

    expect(replayedKeys.keys.find((key) => key.use === 'enc')?.kid).toBe(publishedEncryptionKid);
    const employeeUrl = `/${tenantId}/cds-es/v1/health-care/entity/org.schema/Employee/_batch`;
    const createPayload = structuredClone(EMPLOYEE_REGISTRATION_REQUEST) as any;
    createPayload.thid = 'employee-kms-rehydration-thid';
    createPayload.jti = 'employee-kms-rehydration-jti';
    createPayload.body.data[0].resource = {
      meta: {
        claims: {
          ...(createPayload.body.data[0].meta?.claims || {}),
        },
      },
    };
    createPayload.body.data[0].meta = {};
    createPayload.body.data[0].request = { method: 'POST' };

    const submit = await invokeExpress(restartedHarness.app, {
      method: 'POST',
      url: employeeUrl,
      headers: { 'content-type': 'application/json' },
      body: createPayload,
    });

    expect(submit.status).toBe(202);
    await restartedHarness.queueAdapter.waitForEmptyQueue();

    const poll = await pollJsonBody(restartedHarness.app, submit.headers.location, createPayload.thid);
    expect(poll.status).toBe(200);
    // A tenant without a free employee seat receives the commercial offer
    // projection (200); a pre-licensed tenant creates the employee (201). Both
    // outcomes prove that the restarted KMS decrypted and processed the route.
    expect(['200', '201']).toContain(poll.body.data[0].response.status);
    expect(poll.body.data[0].type).toBeTruthy();
  });
});

async function buildHarness(
  sharedVaultRepository: VaultMemRepository,
  hostCollectionName: string,
  cryptographyService: CryptographyService,
  logger: ConsoleLogger,
): Promise<{
  app: express.Express;
  queueAdapter: QueueAdapterMem;
  kmsService: KmsService;
  tenantManager: TenantsCacheManager;
}> {
  const asyncResponseStore = new AsyncResponseStoreMem();
  let kmsService: KmsService;
  const tenantManager = new TenantsCacheManager(sharedVaultRepository, () => kmsService, hostCollectionName);
  kmsService = new KmsService(cryptographyService, tenantManager, {
    wrappedKeyRepository: new VaultWrappedKeyRepository(sharedVaultRepository, hostCollectionName),
    envelopeAdapter: new InMemoryEnvelopeAdapter(),
  });
  await kmsService.init();

  const mockConfig: IServerConfig = {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: true,
    jsonLegacy: true,
    didcommPlainEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'test',
    port: 3000,
    maxHeaderSize: 131072,
    apiHostname: 'testhost',
    hostExternalDomain: 'testhost.com',
    apiBaseUrl: 'http://testhost:3000',
    namespace: 'test-namespace',
    sectorsAllowed: [Sector.HEALTH_CARE, Sector.TEST],
    allowedPaymentMethods: ['Stripe'],
    dbProvider: 'mem',
    queueProvider: 'mem',
    storageProvider: 'mem',
    host: { legalName: 'Test Host', jurisdiction: 'ES', idType: 'TAX', idValue: 'VATES-B00000000' },
    mongo: { dbName: 'test' },
    firebase: {},
  };
  const hostRuntime: IHostRuntime = { hostCollectionName, hostDid: 'did:web:testhost.com' };

  const hostingManager = new HostingManager(
    sharedVaultRepository,
    kmsService,
    tenantManager,
    new StorageMemAdapter(),
    logger,
    mockConfig,
    hostRuntime,
  );
  const hostAlreadyExists = await sharedVaultRepository.vaultExists('host');
  if (!hostAlreadyExists) {
    await hostingManager.bootstrapHost(hostBootstrapClaims as any);
  }
  await tenantManager.loadHost();

  const managerRegistry: ManagerRegistry = {
    hostingManager,
    employeeManager: new EmployeeManager(sharedVaultRepository, kmsService, tenantManager, tenantManager, hostRuntime),
    licenseManager: new LicenseManager(sharedVaultRepository, kmsService),
    tenantManager,
  };

  const worker = new Worker(managerRegistry, mockConfig.apiBaseUrl, kmsService);
  const queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);

  const app = express.default();
  app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/', createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, sharedVaultRepository, cryptographyService, mockConfig.apiBaseUrl));

  return { app, queueAdapter, kmsService, tenantManager };
}

async function onboardViaActivateAndOrder(app: express.Express, queueAdapter: QueueAdapterMem): Promise<string> {
  const activationPayload = buildActivationPayload() as any;
  const activationSubmit = await invokeExpress(app, {
    method: 'POST',
    url: '/host/cds-es/v1/test/registry/org.schema/Organization/_activate',
    headers: { 'content-type': 'application/json' },
    body: activationPayload,
  });
  expect(activationSubmit.status).toBe(202);
  await queueAdapter.waitForEmptyQueue();

  const activationPoll = await pollJsonBody(app, activationSubmit.headers.location, activationPayload.thid);
  expect(activationPoll.status).toBe(200);

  const activationEntry = activationPoll.body.data[0];
  const offerId = String(activationEntry.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');
  expect(offerId).toBeTruthy();

  const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
  orderPayload.thid = 'tenant-kms-order-thid';
  orderPayload.jti = 'tenant-kms-order-jti';
  orderPayload.body.data[0].meta = {};
  orderPayload.body.data[0].resource = {
    meta: {
      claims: {
        [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
        [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
        [ClaimsOrderSchemaorg.partOfInvoice]: 'tenant-kms-order-invoice',
      },
    },
  };

  const orderSubmit = await invokeExpress(app, {
    method: 'POST',
    url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
    headers: { 'content-type': 'application/json' },
    body: orderPayload,
  });
  expect(orderSubmit.status).toBe(202);
  await queueAdapter.waitForEmptyQueue();

  const orderPoll = await pollJsonBody(app, orderSubmit.headers.location, orderPayload.thid);
  expect(orderPoll.status).toBe(200);

  return String(activationEntry.meta?.claims?.['org.schema.Organization.alternateName'] || '');
}
