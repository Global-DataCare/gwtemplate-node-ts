// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/HostingManager.test.ts

import { jest } from '@jest/globals';
import {
  ORGANIZATION_ORDER_JOB,
  ORGANIZATION_REGISTRATION_JOB,
} from '../../data/example-jobs';
import {
  testHostData,
  testTenant1Data,
  testClaimsTenant1Registration,
  testClaimsHostInitialization,
  testClaimsTenant1AlternateNameInvalidPrefix,
} from '../../data/end-to-end.data';
import * as tenantUtils from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';

import { ILogger } from '../../../loggers/ILogger';
import { testTenant1LegalName } from '../../data/organization.data';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4, validate: uuidValidate } = await import('uuid');
const { HostingManager } = await import('../../../managers/HostingManager');

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};


const mockPublicKeys: JwkSet = {
  keys: [
    { kid: 'key-1', kty: 'OKP', crv: 'Ed25519', x: '...', use: 'sig' },
    { kid: 'key-2', kty: 'OKP', crv: 'X25519', x: '...', use: 'enc' },
  ],
};

// Create a mock KMS service for testing.
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as jest.MockedFunction<IKmsService['provisionKeys']>,
  getPublicJwks: jest.fn() as jest.MockedFunction<IKmsService['getPublicJwks']>,
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
    // In this mock, we retain the content so that unprotect can retrieve it.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' }, content: doc.content };
    delete (secureDoc as any).protectedAttributes;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  getHostPublicJwkSet: jest.fn(),  
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({
  id: 'job-id-123',
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  tenantId: (claims as any)[ClaimsOrganizationSchemaorg.alternateName] || 'host',
  jurisdiction: (claims as any)[ClaimsOrganizationSchemaorg.addressCountry],
  resourceType: 'Organization',
  section: 'registry',
  format: 'org.schema',
  action: '_batch',
  content: {
    iss: 'did:web:requester.example.com',
    jti: 'mock-jti-123',
    aud: 'did:web:api.example.com',
    thid: 'test-thid-123',
    type: 'json',
    body: {
      data: [
        {
          meta: { claims },
          request: { method: 'POST' },
          type: 'Organization-registration-form-v1.0',
        },
      ],
    },
  },
  httpMethod: 'POST',
  requestUrl: '/default',
});

describe('HostingManager', () => {
  let hostingManager: InstanceType<typeof HostingManager>;
  let vaultRepository: IVaultRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  const originalEnv = process.env;

  beforeEach(async () => {
    // This setup mirrors the new Offer/Order Flow tests for consistency.
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
    (uuidValidate as jest.Mock).mockReturnValue(true);

    vaultRepository = new VaultMemRepository();
    const hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName) as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: {
        legalName: 'Test Host',
        jurisdiction: 'us',
        idType: 'test-id',
        idValue: '12345',
      },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    hostingManager = new HostingManager(vaultRepository, mockKmsService, mockTenantsCacheManager, mockStorageAdapter, mockLogger, mockConfig);
    
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);
    
    // Bootstrap the host. This will teach the mock repository the host's collection name.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('[1 HOST: should process the "host" initialization]', async () => {
    const job = testBaseJobForClaims(testClaimsHostInitialization);
    // In the real bootstrap, the host isn't in the cache yet, so we clear the mock for this one test.
    jest.spyOn(vaultRepository, 'get').mockResolvedValue(undefined as any);

    const responsePayload = await hostingManager.process(job);

    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    // Host registration should now also return an offer, aligning with the tenant flow.
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it('[5 TENANT (Happy Path): should create full tenant config and protect it', async () => {
    // PRE-CONDITION: Ensure host vault exists before creating a tenant.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    
    const putSpy = jest.spyOn(vaultRepository, 'put');
    const initialProtectCalls = mockKmsService.protectConfidentialData.mock.calls.length;

    const job = testBaseJobForClaims(testClaimsTenant1Registration);
    const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');

    // Verify the provisional document was created in the host's vault
    const tenantVaultId = tenantUtils.getTenantVaultId(
      testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector,
      testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName]
    );
    const provisionalDoc = await vaultRepository.get(
      await mockTenantsCacheManager.getCollectionName('host') as string,
      tenantVaultId,
      getEnvSectionId('tenants')
    ) as ConfidentialStorageDoc;
    expect(provisionalDoc).toBeDefined();
    expect(provisionalDoc.content).toBeDefined();
    expect(provisionalDoc.content!.status).toBe('pending');
    expect(provisionalDoc.content!.claims[ClaimsOrganizationSchemaorg.legalName]).toBe(testTenant1LegalName);

    // In the initial registration, no vault is created for the tenant yet.
    expect(createVaultSpy).not.toHaveBeenCalled();
    // Keys are not provisioned until the order is processed.
    expect(mockKmsService.provisionKeys).not.toHaveBeenCalledWith(tenantVaultId);
  });

  it("[3 DEMO: should use a non-UUID identifier directly in 'demo' mode", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const demoClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.mockedUuid };
    const job = testBaseJobForClaims(demoClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job, 'demo');
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[2] TENANT: should generate a new UUID for an invalid identifier", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const invalidClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: 'invalid-uuid-format' };
    const job = testBaseJobForClaims(invalidClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[4] TENANT: should generate a new UUID if identifier claim is missing", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const { [ClaimsPersonSchemaorg.identifier]: _, ...noIdClaims } = testClaimsTenant1Registration;
    const job = testBaseJobForClaims(noIdClaims as ClaimsRecord);
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[6] TENANT: should produce an error entry for an invalid alternateName format", async () => {
    const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
  });

  it("[7] TENANT: should produce an error entry if vaultId already exists", async () => {
    const vaultExistsSpy = jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    const responsePayload = await hostingManager.process(job);

    const sector = testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector;
    const alternateName = testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName];
    const expectedVaultId = tenantUtils.getTenantVaultId(sector, alternateName);

    expect(vaultExistsSpy).toHaveBeenCalledWith(expectedVaultId);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(`a vault for '${expectedVaultId}' already exists`);
  });
  
  it("[8 TENANT: should produce an error entry if identifier and country combination already exists", async () => {
    // PRE-CONDITION: Ensure host vault exists
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    
    // Arrange: Simulate that the vault for this tenant already exists.
    jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
    
    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    // Act
    const responsePayload = await hostingManager.process(job);

    // Assert
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('already exists');
  });

  it('[9] TENANT: should produce an error entry if sector claim contains multiple values', async () => {
    const claimsWithMultipleSectors = {
      ...testClaimsTenant1Registration,
      [ClaimsServiceSchemaorg.category]: 'health-care,insurance',
    };
    const job = testBaseJobForClaims(claimsWithMultipleSectors);
    
    const responsePayload = await hostingManager.process(job);
    
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Multiple sectors (comma-separated) are not allowed');
    expect(errorEntry.response.outcome.issue[0].code).toBe('value');
  });

  it('[10] TENANT: should persist all original claims in the tenant configuration', async () => {
    // PRE-CONDITION: Ensure host vault exists before creating a tenant.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const initialProtectCalls = mockKmsService.protectConfidentialData.mock.calls.length;

    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    await hostingManager.process(job);

    // In the Offer/Order flow, only a provisional document is created initially.
    // We expect one call to protect this provisional document.
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(initialProtectCalls + 1);

    // The call should be for the tenant's provisional registration document.
    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[initialProtectCalls][0];
    const provisionalConfig = docToProtect.content as EntityConfig;

    expect(provisionalConfig.claims).toBeDefined();
    const claims = provisionalConfig.claims as ClaimsRecord;

    // Check that all original claims are preserved in the provisional record.
    expect(claims[ClaimsOrganizationSchemaorg.legalName]).toBe(
      testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.legalName],
    );
    expect(claims[ClaimsServiceSchemaorg.category]).toBe(
      testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
    );
    expect(claims[ClaimsPersonSchemaorg.email]).toBe(testClaimsTenant1Registration[ClaimsPersonSchemaorg.email]);
  });
});
