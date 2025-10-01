// src/__tests__/unit/managers/TenantsCacheManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { TenantConfig } from '../../../models/tenant';
import { getTenantVaultId } from '../../../utils/tenant';
import { testTenant1Data } from '../../data/end-to-end.data';
import { Sector } from '../../../models/sector';
import { DidService } from '../../../models/did';

// Mock the entire module. We are not using the actual implementation.
jest.mock('../../../database/repositories/vault/vault.repository');

describe('TenantsCacheManager', () => {
  let tenantsCacheManager: TenantsCacheManager;
  let mockVaultRepository: jest.Mocked<VaultRepository>;
  let mockKmsService: jest.Mocked<IKmsService>;

  // --- Test Data ---
  const MOCK_HOST_TAX_ID = 'A12345678';
  const MOCK_TENANT_TAX_ID = testTenant1Data.taxId;

  const mockServices: DidService[] = [{ id: 'service-1', type: 'TestService', serviceEndpoint: 'https://test.com' }];

  const hostUrn = `urn:antifraud:test-network:us:v1:system:entity:tax:${MOCK_HOST_TAX_ID}`;
  const tenantUrn = `urn:antifraud:test-network:us:v1:health-care:entity:tax:${MOCK_TENANT_TAX_ID}`;

  // CORRECTED: Added all required fields for TenantConfig
  const hostConfig: TenantConfig = {
    id: 'host-uuid',
    type: 'TenantConfig',
    alternateName: 'host',
    legalName: 'System Host',
    identifier: MOCK_HOST_TAX_ID,
    sector: Sector.SYSTEM,
    jurisdiction: 'us',
    url: 'https://host.system.com',
    didConfig: { '@context': '', id: hostUrn, service: [] },
    didDocument: { '@context': '', id: hostUrn },
    meta: { lastUpdated: '' },
  };

  // CORRECTED: Added all required fields for TenantConfig
  const acmeConfig: TenantConfig = {
    id: testTenant1Data.uuid,
    type: 'TenantConfig',
    alternateName: testTenant1Data.alternateName,
    legalName: testTenant1Data.legalName,
    identifier: MOCK_TENANT_TAX_ID,
    sector: Sector.HEALTH_CARE,
    jurisdiction: 'us',
    url: testTenant1Data.url,
    didConfig: { '@context': '', id: tenantUrn, service: mockServices },
    didDocument: { '@context': '', id: tenantUrn },
    meta: { lastUpdated: '' },
  };

  const acmeVaultId = getTenantVaultId(acmeConfig.sector, acmeConfig.alternateName);

  beforeEach(() => {
    mockVaultRepository = {
      getContainersInSection: jest.fn(),
    } as jest.Mocked<any>;

    mockKmsService = {
      unprotectConfidentialData: jest.fn(),
    } as any;

    tenantsCacheManager = new TenantsCacheManager(mockVaultRepository, mockKmsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loadTenants', () => {
    it('should load tenant data and make it available via specific getters', async () => {
      // Arrange
      const mockHostRecord = { id: 'host-record' };
      const mockAcmeRecord = { id: 'acme-record' };
      mockVaultRepository.getContainersInSection.mockResolvedValue([mockAcmeRecord, mockHostRecord]);
      mockKmsService.unprotectConfidentialData
        .mockResolvedValueOnce(acmeConfig)
        .mockResolvedValueOnce(hostConfig);

      // Act
      await tenantsCacheManager.loadTenants();

      // Assert
      expect(tenantsCacheManager.getTenantUrn(acmeVaultId)).toBe(tenantUrn);
      expect(tenantsCacheManager.getDidServiceConfig(acmeVaultId)).toEqual(mockServices);
      expect(tenantsCacheManager.getTenantUrn('host')).toBe(hostUrn);
    });
  });

  describe('getTenantUrn', () => {
    it('should return the URN for an existing tenant', () => {
      (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
      const result = tenantsCacheManager.getTenantUrn(acmeVaultId);
      expect(result).toBe(tenantUrn);
    });

    it('should return undefined for a non-existent tenant', () => {
      const result = tenantsCacheManager.getTenantUrn('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getDidServiceConfig', () => {
    it('should return the service configuration for an existing tenant', () => {
      (tenantsCacheManager as any).tenantCacheByVaultId.set(acmeVaultId, acmeConfig);
      const result = tenantsCacheManager.getDidServiceConfig(acmeVaultId);
      expect(result).toEqual(mockServices);
    });

    it('should return undefined for a non-existent tenant', () => {
      const result = tenantsCacheManager.getDidServiceConfig('non-existent-id');
      expect(result).toBeUndefined();
    });
  });
});
