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
import { JwkSet } from '../../../models/jwk';

// Mock external dependencies
jest.mock('uuid');

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
  decodeJobRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
    delete secureDoc.content;
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

  beforeEach(() => {
    vaultRepository = new VaultMemRepository();
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService) as jest.Mocked<TenantsCacheManager>;

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
      host: {
        legalName: 'Test Host',
        jurisdiction: 'us',
        idType: 'test-id',
        idValue: '12345',
      },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    hostingManager = new HostingManager(vaultRepository, mockKmsService, mockTenantsCacheManager, mockConfig);
    process.env = { ...originalEnv };

    jest.clearAllMocks();
    
    mockKmsService.provisionKeys.mockResolvedValue(mockPublicKeys);
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);

    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
    (uuidValidate as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("[1 HOST: should process the 'host' initialization", async () => {
    const job = testBaseJobForClaims(testClaimsHostInitialization);
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
    // Clear mocks after bootstrap to isolate this test's assertions.
    jest.clearAllMocks(); 
    mockKmsService.provisionKeys.mockResolvedValue(mockPublicKeys);
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);

    const job = testBaseJobForClaims(testClaimsTenant1Registration);
    const putSpy = jest.spyOn(vaultRepository, 'put');
    const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');

    const responsePayload = await hostingManager.process(job);
    expect(responsePayload.body.data[0].response.status).toBe('201');

    const sector = testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector;
    const alternateName = testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName];
    const tenantVaultId = tenantUtils.getTenantVaultId(sector, alternateName);

    expect(createVaultSpy).toHaveBeenCalledWith(expect.objectContaining({ id: tenantVaultId }));
    expect(mockKmsService.provisionKeys).toHaveBeenCalledWith(tenantVaultId);
    // This should now be 1, because we cleared the mocks after bootstrapping the host.
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(1);

    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
    const tenantConfig = docToProtect.content as EntityConfig;

    expect(tenantConfig).toBeDefined();
    expect((tenantConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.legalName]).toBe(testTenant1LegalName);
    expect(tenantConfig.didConfig.service.length).toBeGreaterThan(0);
    expect(tenantConfig.didDocument.verificationMethod).toHaveLength(1);
    expect(tenantConfig.didDocument.service).toBeDefined();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const savedDoc = putSpy.mock.calls[0][1][0] as ConfidentialStorageDoc;
    expect(savedDoc.content).toBeUndefined();
    expect(savedDoc.jwe).toBeDefined();
  });

  it("[3 DEMO: should use a non-UUID identifier directly in 'demo' mode", async () => {
    const demoClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.mockedUuid };
    const job = testBaseJobForClaims(demoClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job, 'demo');

    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe(testTenant1Data.member.admin1.mockedUuid);
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it("[2] TENANT: should generate a new UUID for an invalid identifier", async () => {
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
    
    // Arrange: Simulate an existing tenant config in the repository.
    const existingConfig: Partial<EntityConfig> = {
      // These are the two properties the manager checks for duplicates
      identifier: (testClaimsTenant1Registration as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier],
      jurisdiction: (testClaimsTenant1Registration as ClaimsRecord)[ClaimsOrganizationSchemaorg.addressCountry],
    };
    jest.spyOn(vaultRepository, 'getContainersInSection').mockResolvedValue([existingConfig as EntityConfig]);
    
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
});