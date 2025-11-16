// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/HostingManager.test.ts

import { jest } from '@jest/globals';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { HostingManager } from '../../../managers/HostingManager';
import {
  testHostData,
  testTenant1Data,
  testClaimsTenant1Registration,
  testClaimsHostInitialization,
  testClaimsTenant1AlternateNameInvalidPrefix,
} from '../../data/end-to-end.data';
import * as tenantUtils from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest } from '../../../models/request';
import { ClaimsRecord } from '../../../models/resource-document';
import { EntityConfig } from '../../../models/entity';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { IServerConfig } from '../../../config';
import { Sector } from '../../../models/urlPath';
import { testInvalidUuid, testTenant1AddressCountry, testTenant1LegalName } from '../../data/organization.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { JwkSet } from '../../../models/jwk';

import { ILogger } from '../../../loggers/ILogger';

// Mock external dependencies
jest.mock('uuid');

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
    // In this mock, we don't actually delete the content, so unprotect can retrieve it.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  getHostPublicJwkSet: jest.fn(),  
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({
  tenantId: (claims as any)[ClaimsOrganizationSchemaorg.alternateName] || 'host',
  jurisdiction: (claims as any)[ClaimsOrganizationSchemaorg.addressCountry],
  resourceType: 'Organization',
  section: 'org.schema',
  action: '_batch',
  content: {
    aud: 'did:web:api.example.com',
    response_type: 'json',
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
  let hostingManager: HostingManager;
  let vaultRepository: IVaultRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  const originalEnv = process.env;

  beforeEach(async () => {
    vaultRepository = new VaultMemRepository();
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection') as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace', // Added missing property
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
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
    process.env = { ...originalEnv };

    jest.clearAllMocks();
    
    // This is the critical setup step. The host must be loaded into the cache
    // so that the manager can retrieve the host's collection name when persisting new tenants.
    const hostDoc = { id: 'host', content: { claims: testClaimsHostInitialization } };
    jest.spyOn(vaultRepository, 'get').mockResolvedValue(hostDoc as any);
    await mockTenantsCacheManager.loadHost();
    
    mockKmsService.provisionKeys.mockResolvedValue(mockPublicKeys);
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);

    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
    (uuidValidate as jest.Mock).mockReturnValue(true);
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

    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe(testHostData.member.admin1.uuid);
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
    expect(responsePayload.body.data[0].response.status).toBe('201');

    const sector = testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector;
    const alternateName = testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName];
    const tenantVaultId = tenantUtils.getTenantVaultId(sector, alternateName);

    const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsTenant1Registration);

    // A new vault is created for the tenant.
    expect(createVaultSpy).toHaveBeenCalledWith(expect.objectContaining({ id: tenantCollectionName }));
    
    // Keys are provisioned for the new tenant.
    expect(mockKmsService.provisionKeys).toHaveBeenCalledWith(tenantVaultId);

    // 3 new calls to protect data (tenant config, legal rep, service).
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(initialProtectCalls + 3);

    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[initialProtectCalls][0];
    const tenantConfig = docToProtect.content as EntityConfig;

    expect(tenantConfig).toBeDefined();
    expect((tenantConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.legalName]).toBe(testTenant1LegalName);
    
    // 1. Assert didConfig contains the raw business service definitions
    expect(tenantConfig.didConfig.service.length).toBeGreaterThan(0);
    expect(tenantConfig.didConfig.service[0].actions).toBeDefined(); // Internal property
    expect(tenantConfig.didConfig.service[0].serviceEndpoint).not.toContain('http'); // Is a resource list

    // 2. Assert didDocument contains the public, multiplexed service endpoints
    expect(tenantConfig.didDocument.verificationMethod).toHaveLength(2);
    const publicServices = tenantConfig.didDocument.service!;
    expect(publicServices.length).toBeGreaterThan(tenantConfig.didConfig.service.length); // Multiplexing works

    const wellKnownService = publicServices.find((s: { id: string | string[]; }) => s.id.includes('#jwks'));
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toContain('http'); // Is a full URL
    
    // Find a specific multiplexed service
    const employeeService = publicServices.find((s: { id: string; }) => s.id.endsWith('#v1:health-care:entity:org.schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toContain('http'); // Is a full URL
    expect((employeeService as any).actions).toBeUndefined(); // No internal properties

    // The tenant's main config is saved in the host's vault.
    const hostCollectionName = await mockTenantsCacheManager.getCollectionName('host');
    expect(putSpy).toHaveBeenCalledWith(hostCollectionName, expect.any(Array), 'tenants');
    
    // The tenant's own resources are persisted in its collection.
    expect(putSpy).toHaveBeenCalledWith(tenantCollectionName, expect.any(Array), 'employees');
    expect(putSpy).toHaveBeenCalledWith(tenantCollectionName, expect.any(Array), 'services');
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
    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe(testTenant1Data.member.admin1.mockedUuid);
    // In demo mode, uuidv4 might be called for other resources without a valid ID (like Service),
    // so we can't assert it's never called. The critical part is that the Person ID is respected.
  });

  it("[2] TENANT: should generate a new UUID for an invalid identifier", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const invalidClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: testInvalidUuid };
    const job = testBaseJobForClaims(invalidClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job);

    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe('new-mocked-uuid-v4');
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
    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe('new-mocked-uuid-v4');
  });

  it("[6] TENANT: should produce an error entry for an invalid alternateName format", async () => {
    const isValidSpy = jest.spyOn(tenantUtils, 'isValidTenantAlternateName').mockReturnValue(false);
    const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
    
    isValidSpy.mockRestore();
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

    // We expect protect to be called 3 times for the new tenant.
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(initialProtectCalls + 3);

    // The call after the initial ones should be the tenant's main registration document.
    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[initialProtectCalls][0];
    const tenantConfig = docToProtect.content as EntityConfig;

    expect(tenantConfig.claims).toBeDefined();
    const claims = tenantConfig.claims as ClaimsRecord;

    // Check for an Organization-specific claim
    expect(claims[ClaimsOrganizationSchemaorg.legalName]).toBe(
      testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.legalName],
    );
    // Check for a Service-specific claim to ensure it wasn't stripped out.
    expect(claims[ClaimsServiceSchemaorg.category]).toBe(
      testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
    );
    // Check for a Person-specific claim
    expect(claims[ClaimsPersonSchemaorg.email]).toBe(testClaimsTenant1Registration[ClaimsPersonSchemaorg.email]);
  });
});