// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { config } from '../config';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantConfig } from '../models/tenant';
import { ConfidentialStorageDoc } from '../models/confidential-storage';

/**
 * An in-memory cache implementation of the Tenant Manager.
 * Its primary role is to load all tenant configurations at startup and provide
 * a fast, read-only lookup by alternateName.
 */
export class TenantsCacheManager implements ITenantsManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantCacheByAlternateName = new Map<string, TenantConfig>();

  constructor(vaultRepository: VaultRepository, kmsService: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  /**
   * Loads all tenant configurations from the 'host' vault into memory.
   */
  public async loadTenants(): Promise<void> {
    console.log('[TenantsCacheManager] Loading all tenant configurations into memory...');

    // The repository stores documents as ConfidentialStorageDoc, which are encrypted.
    const secureTenantRecords = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>('host', 'tenants');

    this.tenantCacheByAlternateName.clear();
    for (const record of secureTenantRecords) {
      try {
        // We must unprotect (decrypt) each record to get the actual TenantConfig.
        // The 'host' is the protector of all tenant configurations stored in its vault.
        const tenantConfig = await this.kmsService.unprotectConfidentialData<TenantConfig>(record, 'host');
        if (tenantConfig && tenantConfig.alternateName) {
          this.tenantCacheByAlternateName.set(tenantConfig.alternateName, tenantConfig);
        }
      } catch (error) {
        console.error(`[TenantsCacheManager] Failed to decrypt configuration for tenant record ${record.id}. Skipping.`, error);
      }
    }

    // Also, the host's own config is stored in its vault. We need to load it too.
    if (await this.vaultRepository.vaultExists('host')) {
      const hostRecords = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>('host', 'tenants');
      if (hostRecords.length > 0) {
        try {
          const hostConfig = await this.kmsService.unprotectConfidentialData<TenantConfig>(hostRecords[0], 'host');
          if (hostConfig && hostConfig.alternateName) {
            this.tenantCacheByAlternateName.set(hostConfig.alternateName, hostConfig);
          }
        } catch (error) {
          console.error(`[TenantsCacheManager] Failed to decrypt configuration for host. Skipping.`, error);
        }
      }
    }

    console.log(`[TenantsCacheManager] Successfully loaded ${this.tenantCacheByAlternateName.size} tenants.`);
  }

  /**
   * Retrieves a tenant's configuration from the cache.
   */
  public async getConfigByAlternateName(alternateName: string): Promise<TenantConfig | null> {
    return this.tenantCacheByAlternateName.get(alternateName) || null;
  }

  /**
   * NOTE: The creation of new tenants is now exclusively handled by the
   * OrganizationManager to ensure that key provisioning and secure storage
   * are performed correctly. This manager is now a read-only cache.
   */
}
