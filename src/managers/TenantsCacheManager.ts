// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { EntityConfig } from '../models/entity';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { DidDocument, DidService } from '../models/did';
import { getEnvironment } from '../utils/environment';
import { ClaimsOrganizationSchemaorg } from '../models/schemaorg';
import { Sector } from '../models/path';
import { parseTenantUrn } from '../utils/urn';

/**
 * An in-memory cache implementation of the Tenant Manager.
 * Its primary role is to load all tenant configurations at startup and provide
 * a fast, read-only, and specific lookup for tenant data, acting as a fast
 * ID resolver and service provider. It does not expose the full EntityConfig.
 */
export class TenantsCacheManager implements ITenantsManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantCacheByVaultId = new Map<string, EntityConfig>();

  constructor(vaultRepository: VaultRepository, kmsService: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  public async loadTenants(): Promise<void> {
    console.log('[TenantsCacheManager] Reloading all tenant configurations into memory...');

    this.tenantCacheByVaultId.clear();

    const secureTenantRecords =
      await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>('host', 'tenants');

    for (const record of secureTenantRecords) {
      try {
        const tenantConfig = await this.kmsService.unprotectConfidentialData<EntityConfig>(record, 'host');

        if (tenantConfig) {
          // The alternateName is a required configuration alias stored in the claims.
          const alternateName = (tenantConfig.claims as any)[ClaimsOrganizationSchemaorg.alternateName];
          let sector: string | undefined;

          if (alternateName) {
            if (alternateName === 'host') {
              // The host is a special, sector-agnostic entity.
              // The vaultId will be 'host', so the sector is not strictly needed for caching.
              sector = 'governance'; // Assign a default for consistency.
            } else {
              // For all tenants, the URN in didDocument.id is the single source of truth for the sector.
              const urn = tenantConfig.didDocument?.id;
              const parsedUrn = urn ? parseTenantUrn(urn) : null;
              sector = parsedUrn?.sector;
            }

            if (sector) {
              const vaultId =
                alternateName === 'host' ? 'host' : getTenantVaultId(sector, alternateName);

              if (getEnvironment() !== 'production') {
                console.log(`[TenantsCacheManager] Caching tenant with vaultId: ${vaultId}`);
              }
              this.tenantCacheByVaultId.set(vaultId, tenantConfig);
            } else {
               console.warn(`[TenantsCacheManager] Could not determine sector for tenant with alternateName '${alternateName}'. Skipping cache.`);
            }
          }
        }
      } catch (error) {
        console.error(`[TenantsCacheManager] Failed to decrypt or cache tenant record ${record.id}. Skipping.`, error);
      }
    }

    console.log(`[TenantsCacheManager] Successfully loaded ${this.tenantCacheByVaultId.size} tenants.`);
  }

  public getTenantUrn(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didDocument.id;
  }

  public getDidDocument(vaultId: string): DidDocument | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didDocument;
  }

  public getDidServiceConfig(vaultId: string): DidService[] | undefined {
    console.log(`[TenantsCacheManager] Attempting to get services for vaultId: '${vaultId}'`);
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (!tenantConfig) {
      console.log(`[TenantsCacheManager] Cache MISS for vaultId: '${vaultId}'`);
    } else {
      console.log(`[TenantsCacheManager] Cache HIT for vaultId: '${vaultId}'`);
    }
    return tenantConfig?.didConfig.service;
  }

  /**
   * Retrieves the cached DID identifier (`did:web:...`) for a given tenant.
   * @param vaultId The unique vault identifier for the tenant (e.g., 'host', 'health-care_acme').
   * @returns The DID string, or `undefined` if the tenant is not found in the cache.
   */
  public getTenantDid(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didDocument.id;
  }

  /**
   * Retrieves the cached sector for a given tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The sector, or `undefined` if the tenant is not found.
   */
  public getTenantSector(vaultId: string): Sector | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (!tenantConfig) return undefined;
    
    // For tenants, the single source of truth for the sector is the URN.
    const urn = tenantConfig.didDocument?.id;
    const parsedUrn = urn ? parseTenantUrn(urn) : null;
    return parsedUrn?.sector as Sector;
  }

  /**
   * Retrieves the cached jurisdiction for a given tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The jurisdiction string (e.g., 'us'), or `undefined` if not found.
   */
  public getTenantJurisdiction(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (!tenantConfig) return undefined;
    return (tenantConfig.claims as any)[ClaimsOrganizationSchemaorg.addressCountry] as string;
  }
}