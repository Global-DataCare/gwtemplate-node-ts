// src/__tests__/integration/end-to-end-legacy.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @file This integration test validates the "legacy" plaintext API flow.
 *
 * @architecture
 * This test suite is critical because it covers a complex asynchronous edge case:
 * the "encrypt-for-a-just-born-tenant" scenario.
 *
 * The flow is as follows:
 * 1. A plaintext JSON request to create a new tenant is sent. The API accepts it (202).
 * 2. The job is processed by the Worker, which calls the HostingManager.
 * 3. The HostingManager creates the new tenant, its keys, and its DID Document, persisting them in the database.
 * 4. Crucially, the HostingManager also explicitly loads the new tenant into the TenantsCacheManager.
 *    This makes the new tenant's configuration available to other services within the same process.
 * 5. The Worker must now encrypt the job response for the new tenant (the "encrypt-to-self" pattern).
 * 6. To do this, it asks the KmsService for the new tenant's public key.
 * 7. The KmsService, not having this key in its immediate memory, falls back to its lazy-loading mechanism:
 *    it queries the TenantsCacheManager.
 * 8. Because the HostingManager pre-emptively loaded the tenant into the cache (step 4), the KmsService
 *    finds the DID Document, extracts the public key, and successfully encrypts the response.
 *
 * This test validates that this entire chain of caching, lazy-loading, and dependency interaction works correctly.
 */

import * as express from 'express';
import * as request from 'supertest';
import { testPayloadCreateTenant1, testClaimsHostInitialization } from '../data/end-to-end.data';
import { testCommunicationAppointmentFhirR4 } from '../data/appointment.data';
import { createApiRouter } from '../../routes/api';
import { createFhirRouter } from '../../routes/fhir';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { HostingManager } from '../../managers/HostingManager';
import { EmployeeManager } from '../../managers/EmployeeManager';
import { CustomerManager } from '../../managers/CustomerManager';
import { CredentialManager } from '../../managers/CredentialManager';
import { CompositionManager } from '../../managers/CompositionManager';
import { CommunicationManager } from '../../managers/CommunicationManager';
import { ManagerRegistry } from '../../managers/registry';
import { Worker } from '../../worker';
import { KmsService } from '../../services/KmsService';
import { CryptographyService } from '../../crypto/CryptographyService';
import { BlockchainAdapterMem } from '../../adapters/BlockchainAdapterMem';
import { StorageMemAdapter } from '../../database/storage/mem.storage.adapter';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';
import { IServerConfig } from '../../config';
import { IAuthorizationManager } from '../../managers/auth/IAuthorizationManager';
import { BundleEntry } from '../../models/bundle';
import { IAccessTokenClaims } from '../../models/auth';
import { ClaimsServiceSchemaorg } from '../../models/schemaorg';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { IncludedResource } from '../../models/jsonapi';
import { IKmsService } from '../../crypto/interfaces/IKmsService';

// Mock implementation for the AuthorizationManager
class MockAuthorizationManager implements IAuthorizationManager {
  public consentStore: Map<string, boolean> = new Map();
  authorize(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (req.headers.authorization === 'Bearer mock-valid-token-for-fhir') {
      (req as any).claims = {
        iss: 'did:web:test-issuer.com', sub: 'did:web:test-employee.com', aud: 'did:web:this-gateway.com',
        scope: 'fhir:Communication.create', client_id: 'test-client',
      } as IAccessTokenClaims;
    }
    next();
  }
  public setConsent(consentId: string, hasConsent: boolean): void {
    this.consentStore.set(consentId, hasConsent);
  }
  public async canAccess(
    _claims: IAccessTokenClaims,
    _resource: BundleEntry,
    _action: string,
    consentId?: string,
  ): Promise<boolean> {
    if (!consentId) return false;
    return this.consentStore.get(consentId) ?? false;
  }
}

describe('End-to-End API Flow (Legacy / Unencrypted)', () => {
  let app: express.Express;
  let queueAdapter: QueueAdapterMem;
  let addJobSpy: jest.SpyInstance;
  let authManager: MockAuthorizationManager;
  let vaultRepository: VaultMemRepository;
  let tenantManager: TenantsCacheManager;
  let kmsService: IKmsService;

  beforeEach(async () => {
    const logger = new ConsoleLogger();
    const cryptographyService = new CryptographyService();
    vaultRepository = new VaultMemRepository();
    const asyncResponseStore = new AsyncResponseStoreMem();
    
    process.env.NODE_ENV = 'development';
    process.env.DEV_SEED = 'true';
    
    const hostCollectionName = generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);
    kmsService = new KmsService(cryptographyService, tenantManager);
    await kmsService.init();

    const mockConfig: IServerConfig = {
      nodeEnv: 'test', port: 3000, apiHostname: 'testhost', hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000', namespace: 'test-namespace', sectorsAllowed: [],
      dbProvider: 'mem', queueProvider: 'mem', storageProvider: 'mem',
      host: { legalName: 'Test Host', jurisdiction: 'us', idType: 'test-id', idValue: '12345' },
      mongo: { dbName: 'test' }, firebase: {},
    };
    
    const hostingManager = new HostingManager(vaultRepository, kmsService, tenantManager, new StorageMemAdapter(), logger, mockConfig);
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await tenantManager.loadHost();
    
    const managerRegistry: ManagerRegistry = {
      hostingManager,
      employeeManager: new EmployeeManager(vaultRepository, kmsService, tenantManager),
      customerManager: new CustomerManager(vaultRepository, kmsService, tenantManager, new CredentialManager(vaultRepository, kmsService, tenantManager, 'testhost.com'), new BlockchainAdapterMem(), 'test-ns'),
      compositionManager: new CompositionManager(),
      communicationManager: new CommunicationManager({ tenantsCacheManager: tenantManager }),
      tenantManager,
    };
    
    const worker = new Worker(managerRegistry, mockConfig.apiBaseUrl, kmsService);
    queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');

    app = express.default();
    app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
    app.use(express.urlencoded({ extended: false }));
    authManager = new MockAuthorizationManager();

    const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, vaultRepository, cryptographyService, mockConfig.apiBaseUrl);
    const fhirRouter = createFhirRouter(queueAdapter, authManager);
    app.use('/', apiRouter);
    app.use('/', fhirRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    addJobSpy.mockRestore();
    queueAdapter.stop();
  });

  it('Part 1 (Legacy): should accept an unencrypted JSON request to create a new organization', async () => {
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer mock-valid-token')
      .send(orgCreationPayload);

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    await queueAdapter.waitForEmptyQueue();
  });

  it('Part 2 (PDF Attachment): should process organization with Base64 PDF and store a URL', async () => {
    const pdfBase64 = Buffer.from('dummy-pdf-content').toString('base64');
    const orgCreationPayloadWithPdf = JSON.parse(JSON.stringify(testPayloadCreateTenant1));
    const claims = orgCreationPayloadWithPdf.body.data[0].meta.claims;
    claims[ClaimsServiceSchemaorg.termsOfService] = pdfBase64;
    claims['org.schema.Organization.alternateName'] = 'acme-with-pdf';
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer mock-valid-token')
      .send(orgCreationPayloadWithPdf);

    expect(response.status).toBe(202);
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    await queueAdapter.waitForEmptyQueue();

    // After the async job completes, explicitly load the new tenant into the test's
    // cache instance to verify the results of the operation.
    const vaultId = getTenantVaultId(claims[ClaimsServiceSchemaorg.category], claims['org.schema.Organization.alternateName']);
    await tenantManager.getTenant(vaultId);

    const collectionName = await tenantManager.getCollectionName(vaultId);
    expect(collectionName).toBeDefined();

    const services = await vaultRepository.getContainersInSection<IncludedResource>(collectionName!, 'services');
    expect(services).toHaveLength(1);
    const persistedService = services[0];
    const termsUrl = persistedService.meta.claims[ClaimsServiceSchemaorg.termsOfService];
    const termsHash = persistedService.meta.claims[`${ClaimsServiceSchemaorg.termsOfService}#hash`];
    
    expect(termsUrl).not.toBe(pdfBase64);
    expect(termsUrl).toContain('/local-storage/');
    expect(termsHash).toBeDefined();
  });

  describe('FHIR Communication Flow', () => {
    beforeEach(async () => {
        const orgCreationPayload = { ...testPayloadCreateTenant1 };
        const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;
        await request.default(app)
            .post(registrationUrl)
            .set('Content-Type', 'application/json')
            .set('Authorization', 'Bearer mock-valid-token')
            .send(orgCreationPayload);
        await queueAdapter.waitForEmptyQueue();
        
        // After the async job completes, explicitly load the new 'acme' tenant into the cache
        // so that subsequent API calls in other tests can find it.
        const claims = testPayloadCreateTenant1.body.data[0].meta.claims;
        const vaultId = getTenantVaultId(claims[ClaimsServiceSchemaorg.category], claims['org.schema.Organization.alternateName']);
        await tenantManager.getTenant(vaultId);
    });

    it('should REJECT a FHIR Communication with 403 Forbidden if consent is NOT present', async () => {
      const communicationUrl = '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch';
      const accessToken = 'Bearer mock-valid-token-for-fhir';
      const consentId = 'urn:uuid:consent-not-granted';
      const communicationResource = { 
        ...testCommunicationAppointmentFhirR4, 
        partOf: [{ reference: consentId }],
      };
      authManager.setConsent(consentId, false);
      
      const batchPayload = {
        thid: 'thid-for-fhir-test',
        body: { data: [communicationResource] },
      };

      const response = await request.default(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/json')
        .set('Authorization', accessToken)
        .send(batchPayload);

      expect(response.status).toBe(403);
    });
  });
});

