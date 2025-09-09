// src/managers/TenantManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITenantManager } from './ITenantManager';
import { VaultRepository } from '@/database/repositories/vault/vault.repository';
import { config } from '../config';
import { SchemaorgOrganizationParam } from '@/models/params';
import { RecordBase } from '@/models/resource-document';
import { TenantConfig } from '@/models/tenant';

/**
 * An in-memory cache implementation of the Tenant Manager.
 */
export class TenantCacheManager implements ITenantManager {
  private vaultRepository: VaultRepository;
  private tenantCacheByAlternateName = new Map<string, TenantConfig>();

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Loads all tenant configurations from the 'host' vault into memory.
   */
  public async loadTenants(): Promise<void> {
    const hostVaultId = 'host';
    const tenantsSectionId = 'tenants';
    console.log('[TenantManager] Loading all tenant configurations into memory...');

    // The repository stores generic RecordBase documents.
    // In a real flow, these would be unencrypted ConfidentialStorageDocs,
    // and we would extract the .content property. For now, we cast.
    const tenantRecords = await this.vaultRepository.getContainersInSection<RecordBase>(hostVaultId, tenantsSectionId);

    this.tenantCacheByAlternateName.clear();
    for (const record of tenantRecords) {
      const tenantConfig = record as TenantConfig;
      if (tenantConfig && tenantConfig.alternateName) {
        this.tenantCacheByAlternateName.set(tenantConfig.alternateName, tenantConfig);
      }
    }

    console.log(`[TenantManager] Successfully loaded ${this.tenantCacheByAlternateName.size} tenants.`);
  }

  /**
   * Retrieves a tenant's configuration from the cache.
   */
  public async getConfigByAlternateName(alternateName: string): Promise<TenantConfig | null> {
    return this.tenantCacheByAlternateName.get(alternateName) || null;
  }

  /**
   * Creates a new tenant configuration and its associated vault.
   * @param id The client-provided unique identifier for the tenant.
   * @param params The tenant's configuration details.
   */
  public async set(id: string, params: SchemaorgOrganizationParam): Promise<TenantConfig> {
    const hostVaultId = 'host';
    const tenantsSectionId = 'tenants';
    const alternateName = params.legalName.toLowerCase().replace(/\s/g, '-');
    const domain = params.domain;

    // 1. Construct the full tenant configuration document from the basic input.
    const newTenantConfig: TenantConfig = {
      id: id,
      alternateName,
      legalName: params.legalName,
      identifier: params.identifier,
      url: `${config.apiBaseUrl}/${alternateName}`,
      sector: 'healthcare', // Assuming default sector
      jurisdiction: params.addressCountry,
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: `did:web:${domain}:${alternateName}`,
        service: [
          {
            type: 'default-employee-service',
            id: 'v1_healthcare_employees_jsonapi_Employee_path',
            serviceEndpoint: 'Employee',
            actions: ['_batch'],
          },
          {
            type: 'default-customer-service',
            id: 'v1_healthcare_profiles_jsonapi_Customer_path',
            serviceEndpoint: 'Customer',
            actions: ['_update'],
          }
        ]
      },
      additionalType: params.additionalType,
      meta: {
        lastUpdated: new Date().toISOString()
      }
    };

    // Note: The concept of ConfidentialStorageDoc is handled inside the manager
    // that needs it (like OrganizationManager). This manager deals with the
    // plaintext TenantConfig.

    // 2. Create the tenant's own vault if it doesn't exist.
    const vaultExists = await this.vaultRepository.vaultExists(alternateName);
    if (!vaultExists) {
      await this.vaultRepository.createNewVault({ id: alternateName });
    }

    // 3. Store the tenant's configuration document in the central 'host' vault.
    await this.vaultRepository.put(hostVaultId, [newTenantConfig], tenantsSectionId);

    // 4. Update the in-memory cache.
    this.tenantCacheByAlternateName.set(newTenantConfig.alternateName, newTenantConfig);

    return newTenantConfig;
  }
}
