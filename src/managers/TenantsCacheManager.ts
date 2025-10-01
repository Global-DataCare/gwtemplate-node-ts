// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantConfig } from '../models/tenant';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { DidService } from '../models/did';
import { getEnvironment } from '../utils/environment';

/**
 * An in-memory cache implementation of the Tenant Manager.
 * Its primary role is to load all tenant configurations at startup and provide
 * a fast, read-only, and specific lookup for tenant data, acting as a fast
 * ID resolver and service provider. It does not expose the full TenantConfig.
 */
export class TenantsCacheManager implements ITenantsManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantCacheByVaultId = new Map<string, TenantConfig>();

  constructor(vaultRepository: VaultRepository, kmsService: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  public async loadTenants(): Promise<void> {
    console.log('[TenantsCacheManager Reloading all tenant configurations into memory...');

    this.tenantCacheByVaultId.clear();

    const secureTenantRecords =
      await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>('host', 'tenants');

    for (const record of secureTenantRecords) {
      try {
        const tenantConfig = await this.kmsService.unprotectConfidentialData<TenantConfig>(record, 'host');
        if (tenantConfig && tenantConfig.alternateName) {
          const vaultId =
            tenantConfig.alternateName === 'host'
              ? 'host'
              : getTenantVaultId(tenantConfig.sector, tenantConfig.alternateName);

          if (getEnvironment() !== 'production') {
            console.log(`[TenantsCacheManager] Caching tenant with vaultId: ${vaultId}`);
          }
          this.tenantCacheByVaultId.set(vaultId, tenantConfig);
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
}