// src/__tests__/unit/managers/TenantsCacheManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DidService } from '../../../gdc-backend-utils-node/models/did';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testConfigDataHost, testConfigTenant1 } from '../../data/organization.data';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';

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
  const hostCollectionName = 'test-host-collection'; // Define for the whole suite

  // --- Test Data ---
  const mockServices: DidService[] = [{ id: 'service-1', type: 'TestService', serviceEndpoint: 'https://test.com' }];

  const hostUrn = (testClaimsHostInitialization as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const hostConfig: EntityConfig = {
    id: testConfigDataHost.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims: testClaimsHostInitialization,
    didConfig: { service: [] },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: hostUrn },
    meta: { lastUpdated: '' },
  };

  const tenantUrn = (testClaimsTenant1Registration as ClaimsRecord)[ClaimsOrganizationSchemaorg.identifier];
  const acmeConfig: EntityConfig = {
    id: testConfigTenant1.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims: testClaimsTenant1Registration,
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

    tenantsCacheManager = new TenantsCacheManager(mockVaultRepository, () => mockKmsService, hostCollectionName);
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
      // This test validates the core lazy-loading logic.
      // It ensures that when a tenant's config is requested for the first time,
      // the manager correctly queries the HOST's physical collection to find it.

      const mockAcmeRecord = { id: acmeVaultId, content: acmeConfig };
      mockVaultRepository.get.mockResolvedValue(mockAcmeRecord);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const expectedCollectionName = generateTenantCollectionNameFromClaims(acmeConfig.claims as ClaimsRecord);

      // --- First Call (Cache Miss) ---
      const collectionName1 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      expect(collectionName1).toBe(expectedCollectionName);
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);

             // The manager should now use the PHYSICAL host collection name to find the tenant record.
       expect(mockVaultRepository.get).toHaveBeenCalledWith(hostCollectionName, acmeVaultId, 'tenants');
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1);

      // --- Second Call (Cache Hit) ---
      const collectionName2 = await tenantsCacheManager.getCollectionName(acmeVaultId);

      // Assert that we get the same result without calling the repository again.
      expect(collectionName2).toBe(expectedCollectionName);
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1); // Should not be called again
      expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should return undefined for a tenant that does not exist in the repository', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const collectionName = await tenantsCacheManager.getCollectionName('non-existent-id');
      expect(collectionName).toBeUndefined();
      expect(mockVaultRepository.get).toHaveBeenCalledTimes(1);
      expect(mockKmsService.unprotectConfidentialData).not.toHaveBeenCalled();
    });
  });

  describe('getTenantDid', () => {
    // These tests now check the on-demand caching logic.
    it('should return the DID for an existing tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const result = await tenantsCacheManager.getTenantDid(acmeVaultId);
      expect(result).toBe(tenantUrn);
    });

    it('should return the DID for the host', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: 'host' } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(hostConfig);
      const result = await tenantsCacheManager.getTenantDid('host');
      expect(result).toBe(hostUrn);
    });

    it('should return undefined for a non-existent tenant', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const result = await tenantsCacheManager.getTenantDid('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getDidServiceConfig', () => {
    it('should return the service configuration for an existing tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const result = await tenantsCacheManager.getDidServiceConfig(acmeVaultId);
      expect(result).toEqual(mockServices);
    });

    it('should return the service configuration for the host', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: 'host' } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(hostConfig);
      const result = await tenantsCacheManager.getDidServiceConfig('host');
      expect(result).toEqual([]);
    });

    it('should return undefined for a non-existent tenant', async () => {
      mockVaultRepository.get.mockResolvedValue(undefined);
      const result = await tenantsCacheManager.getDidServiceConfig('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getTenantSector', () => {
    it('should correctly extract the sector from a cached tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const sector = await tenantsCacheManager.getTenantSector(acmeVaultId);
      expect(sector).toBe(acmeSector);
    });
  });

  describe('getTenantJurisdiction', () => {
    it('should correctly extract the jurisdiction from a cached tenant', async () => {
      mockVaultRepository.get.mockResolvedValue({ id: acmeVaultId } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(acmeConfig);
      const jurisdiction = await tenantsCacheManager.getTenantJurisdiction(acmeVaultId);
      expect(jurisdiction).toBe((acmeConfig.claims as ClaimsRecord)[ClaimsOrganizationSchemaorg.addressCountry]);
    });
  });
});
