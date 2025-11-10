// src/__tests__/unit/managers/TenantsCacheManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { EntityConfig } from '../../../models/entity';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { Sector } from '../../../models/urlPath';
import { DidService } from '../../../models/did';
import { ClaimsRecord } from '../../../models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { testConfigDataHost, testConfigTenant1 } from '../../data/organization.data';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../../data/end-to-end.data';

// Mock the entire module. We are not using the actual implementation.
jest.mock('../../../database/repositories/vault/vault.repository');
jest.mock('../../../utils/tenant', () => ({
  ...jest.requireActual('../../../utils/tenant') as any,
  generateTenantCollectionNameFromClaims: jest.fn(),
}));


describe('TenantsCacheManager', () => {
  let tenantsCacheManager: TenantsCacheManager;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockKmsService: jest.Mocked<IKmsService>;

  // --- Test Data ---
  const mockServices: DidService[] = [{ id: 'service-1', type: 'TestService', serviceEndpoint: 'https://test.com' }];

  // Create valid, model-compliant EntityConfig objects for testing, using fixtures.
  const hostUrn = (testClaimsHostInitialization as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const hostConfig: EntityConfig = {
    id: testConfigDataHost.id,
    type: 'Organization',
    status: 'active',
    claims: testClaimsHostInitialization,
    didConfig: { service: [] },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: hostUrn },
    meta: { lastUpdated: '' },
  };

  const tenantUrn = (testClaimsTenant1Registration as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const acmeConfig: EntityConfig = {
    id: testConfigTenant1.id, // The UUID comes from the base config object
    type: 'Organization',
    status: 'active',
    claims: testClaimsTenant1Registration, // Use the fully assembled claims object
    didConfig: { service: mockServices },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: tenantUrn },
    meta: { lastUpdated: '' },
  };

  const acmeSector = (acmeConfig.claims as ClaimsRecord)[ClaimsServiceSchemaorg.category] as Sector;
  const acmeAlternateName = (acmeConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.alternateName];
  const acmeVaultId = getTenantVaultId(acmeSector, acmeAlternateName);

  beforeEach(() => {
    mockVaultRepository = {
      getContainersInSection: jest.fn(),
      get: jest.fn(),
    } as jest.Mocked<any>;

    mockKmsService = {
      unprotectConfidentialData: jest.fn(),
    } as any;

    tenantsCacheManager = new TenantsCacheManager(mockVaultRepository, () => mockKmsService);
    (generateTenantCollectionNameFromClaims as jest.Mock).mockImplementation((claims: ClaimsRecord) => {
        const value = claims[ClaimsOrganizationSchemaorg.identifierValue];
        return `_${value}_`;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCollectionName (Lazy Loading)', () => {
    it('should fetch, decrypt, cache, and return the collection name for an uncached tenant', async () => {
      // Arrange
      const mockAcmeRecord = { id: acmeVaultId, content: acmeConfig };
      mockVaultRepository.get.mockResolvedValue(mockAcmeRecord);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const expectedCollectionName = generateTenantCollectionNameFromClaims(acmeConfig.claims as ClaimsRecord);

      // --- ACTION 1: First call for the tenant ---
      const collectionName1 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      // --- ASSERT 1: Verify it fetched and decrypted ---
      expect(collectionName1).toBe(expectedCollectionName);
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);
      expect(mockVaultRepository.get).toHaveBeenCalledWith('host', acmeVaultId, 'tenants');
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1);
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledWith(mockAcmeRecord, 'host');

      // --- ACTION 2: Second call for the SAME tenant ---
      const collectionName2 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      // --- ASSERT 2: Verify it used the cache ---
      expect(collectionName2).toBe(expectedCollectionName);
      // The mocks should NOT have been called again.
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1);
    });

    it('should return undefined for a tenant that does not exist in the repository', async () => {
      // Arrange
      mockVaultRepository.get.mockResolvedValue(undefined);

      // Act
      const collectionName = await tenantsCacheManager.getCollectionName('non-existent-id');

      // Assert
      expect(collectionName).toBeUndefined();
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);
      expect(mockKmsService.unprotectConfidentialData).not.toHaveBeenCalled();
    });
  });

  describe('getTenantDid', () => {
    beforeEach(() => {
        (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
        (tenantsCacheManager as any).tenantCacheByVaultId.set('host', hostConfig);
    });

    it('should return the DID for an existing tenant', () => {
      const result = tenantsCacheManager.getTenantDid(acmeVaultId);
      expect(result).toBe(tenantUrn);
    });

    it('should return the DID for the host', () => {
        const result = tenantsCacheManager.getTenantDid('host');
        expect(result).toBe(hostUrn);
    });

    it('should return undefined for a non-existent tenant', () => {
      const result = tenantsCacheManager.getTenantDid('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getDidServiceConfig', () => {
    beforeEach(() => {
        (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
        (tenantsCacheManager as any).tenantCacheByVaultId.set('host', hostConfig);
    });

    it('should return the service configuration for an existing tenant', () => {
      const result = tenantsCacheManager.getDidServiceConfig(acmeVaultId);
      expect(result).toEqual(mockServices);
    });

    it('should return the service configuration for the host', () => {
        const result = tenantsCacheManager.getDidServiceConfig('host');
        expect(result).toEqual([]); // The mock host has no services
    });

    it('should return undefined for a non-existent tenant', () => {
      const result = tenantsCacheManager.getDidServiceConfig('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getTenantSector', () => {
    it('should correctly extract the sector from a cached tenant', () => {
        (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
        const sector = tenantsCacheManager.getTenantSector(acmeVaultId);
        expect(sector).toBe(acmeSector);
    });
  });

  describe('getTenantJurisdiction', () => {
    it('should correctly extract the jurisdiction from a cached tenant', () => {
        (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
        const jurisdiction = tenantsCacheManager.getTenantJurisdiction(acmeVaultId);
        expect(jurisdiction).toBe((acmeConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.addressCountry]);
    });
  });
});