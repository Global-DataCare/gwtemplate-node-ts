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
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest } from '../../../models/request';
import { ClaimsRecord } from '../../../models/resource-document';
import { EntityConfig } from '../../../models/entity';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { IServerConfig } from '../../../config';
import { Sector } from '../../../models/sector';
import { testInvalidUuid } from '../../data/organization.data';
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
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({
  // Correctly derive tenantId from claims or default to 'host'
  tenantId: claims[ClaimsOrganizationSchemaorg.alternateName] || 'host',
  jurisdiction: claims[ClaimsOrganizationSchemaorg.addressCountry],
  resourceType: 'Organization',
  section: 'org.schema',
  action: '_batch',
  input: {
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
  fullUrl: '/default',
});

describe('HostingManager', () => {
  let hostingManager: HostingManager;
  let vaultRepository: VaultRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  const originalEnv = process.env;

  beforeEach(() => {
    vaultRepository = new VaultMemRepository();
    // We need a mocked instance of TenantsCacheManager for the HostingManager's constructor
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, mockKmsService) as jest.Mocked<TenantsCacheManager>;

    // Create a default mock config for most tests
    mockConfig = {
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
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
    
    // Reset mocks that were configured in the top-level scope
    mockKmsService.provisionKeys.mockResolvedValue(mockPublicKeys);
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);

    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
    (uuidValidate as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('[5 TENANT (Happy Path): should create full tenant config and protect it', async () => {
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
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(1);

    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
    const tenantConfig = docToProtect.content as EntityConfig;

    expect(tenantConfig).toBeDefined();
    expect(tenantConfig.legalName).toBe(testTenant1Data.legalName);
    // Check that both didConfig and didDocument were created
    expect(tenantConfig.didConfig.service.length).toBeGreaterThan(0);
    expect(tenantConfig.didDocument.verificationMethod).toHaveLength(mockPublicKeys.keys.length);
    expect(tenantConfig.didDocument.service).toBeDefined();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const savedDoc = putSpy.mock.calls[0][1][0] as ConfidentialStorageDoc;
    expect(savedDoc.content).toBeUndefined();
    expect(savedDoc.jwe).toBeDefined();
  });

  it("[1] HOST: should process the 'host' initialization", async () => {
    const job = testBaseJobForClaims(testClaimsHostInitialization);
    const responsePayload = await hostingManager.process(job);

    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');

    expect(entry.resource).toBeDefined();
    const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
    expect(person.id).toBe(testHostData.member.admin1.uuid);
  });

  it("[3] DEMO: should use a non-UUID identifier directly in 'demo' mode", async () => {
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
    // Temporarily spy on and mock the return value for this specific test
    const isValidSpy = jest.spyOn(tenantUtils, 'isValidTenantAlternateName').mockReturnValue(false);
    const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
    
    isValidSpy.mockRestore(); // Clean up the spy
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
  
  it("[8] TENANT: should produce an error entry if taxID and country combination already exists", async () => {
    const existingConfig: Partial<EntityConfig> = { identifier: testTenant1Data.identifier, jurisdiction: testTenant1Data.addressCountry, sector: Sector.HEALTH_CARE };
    jest.spyOn(vaultRepository, 'getContainersInSection').mockResolvedValue([existingConfig as EntityConfig]);
    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    const responsePayload = await hostingManager.process(job);

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
