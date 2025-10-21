// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { getTenantVaultId, getIdentifierUrnFromClaims } from '../utils/tenant';
import { DidDocument, DidService, VerificationMethod } from '../models/did';
import { getEnvironment } from '../utils/environment';
import { ClaimsOrganizationSchemaorg } from '../models/schemaorg';
import { Sector } from '../models/path';
import { getBaseUrlFromDidWeb } from '../utils/did';
import { parseTenantUrn } from '../utils/urn';

/**
 * An in-memory cache implementation of the Tenant Manager.
 * Its primary role is to load all tenant configurations at startup and provide
 * a fast, read-only, and specific lookup for tenant data, acting as a fast
 * ID resolver and service provider. It does not expose the full EntityConfig.
 */
export class TenantsCacheManager implements ITenantsManager {
  private vaultRepository: VaultRepository;
  private kmsServiceResolver: () => IKmsService;
  private tenantCacheByVaultId = new Map<string, any>();
  private get kmsService(): IKmsService {
    return this.kmsServiceResolver();
  }

  constructor(vaultRepository: VaultRepository, kmsServiceResolver: () => IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsServiceResolver = kmsServiceResolver;
  }

  public async loadTenants(): Promise<void> {
    // console.log('[TenantsCacheManager] Reloading all tenant configurations into memory...');

    this.tenantCacheByVaultId.clear();

    const secureTenantRecords =
      await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>('host', 'tenants');

    for (const record of secureTenantRecords) {
      try {
        const tenantConfig = await this.kmsService.unprotectConfidentialData<any>(record, 'host');

        if (tenantConfig) {
          const alternateName = tenantConfig.claims[ClaimsOrganizationSchemaorg.alternateName];
          let sector: string | undefined;

          if (alternateName) {
            if (alternateName === 'host') {
              sector = 'governance';
            } else {
              // The sector must be parsed from the canonical identifier (URN) in the claims.
              const urn = getIdentifierUrnFromClaims(tenantConfig.claims);
              const parsedUrn = urn ? parseTenantUrn(urn) : null;
              sector = parsedUrn?.sector;
            }

            if (sector) {
              const vaultId =
                alternateName === 'host' ? 'host' : getTenantVaultId(sector, alternateName);

              if (getEnvironment() !== 'production') {
                // console.log(`[TenantsCacheManager] Caching tenant with vaultId: ${vaultId}`);
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

    // console.log(`[TenantsCacheManager] Successfully loaded ${this.tenantCacheByVaultId.size} tenants.`);
  }

  /**
   * Retrieves the full, cached configuration for a tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The tenant's configuration object, or `undefined` if not found.
   */
  public getTenant(vaultId: string): any | undefined {
    return this.tenantCacheByVaultId.get(vaultId);
  }

  /**
   * Finds a tenant in the cache by their full DID identifier.
   * @param did The `did:web:...` identifier of the tenant.
   * @returns The tenant's configuration object, or `undefined` if no tenant matches the DID.
   */
  public findTenantByDid(did: string): any | undefined {
    for (const tenantConfig of this.tenantCacheByVaultId.values()) {
      if (tenantConfig.didDocument?.id === did) {
        return tenantConfig;
      }
    }
    return undefined;
  }

  /**
   * Finds a tenant in the cache where the tenant's DID is a prefix of the provided DID.
   * This is used to resolve an employee or individual's DID back to their parent tenant
   * when the DID is from an external domain.
   * @param did The `did:web:...` identifier of the entity (e.g., an employee).
   * @returns The tenant's configuration object, or `undefined` if no tenant matches.
   */
  public findTenantByDidPrefix(did: string): any | undefined {
    // Find the tenant whose DID is the longest matching prefix of the given DID.
    let bestMatch: any | undefined;
    let longestPrefix = 0;

    for (const tenantConfig of this.tenantCacheByVaultId.values()) {
      const tenantDid = tenantConfig.didDocument?.id;
      if (tenantDid && did.startsWith(tenantDid)) {
        if (tenantDid.length > longestPrefix) {
          longestPrefix = tenantDid.length;
          bestMatch = tenantConfig;
        }
      }
    }
    return bestMatch;
  }

  /**
   * Adds a new verification method (e.g., a public key) to a tenant's cached DID document.
   * This is used when an employee is registered to make their keys discoverable via the tenant's DID.
   * @param vaultId The vault ID of the tenant to modify.
   * @param verificationMethod The verification method object to add.
   */
  public addVerificationMethodToTenant(vaultId: string, verificationMethod: VerificationMethod): void {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (tenantConfig) {
      if (!tenantConfig.didDocument.verificationMethod) {
        tenantConfig.didDocument.verificationMethod = [];
      }
      tenantConfig.didDocument.verificationMethod.push(verificationMethod);
      this.tenantCacheByVaultId.set(vaultId, tenantConfig);
    } else {
      console.warn(`[TenantsCacheManager] Could not add verification method: Tenant with vaultId '${vaultId}' not found in cache.`);
    }
  }

  /**
   * Retrieves the canonical URN for a tenant from its cached claims.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The URN string, or `undefined` if not found.
   */
  public getTenantIdentifierUrn(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return getIdentifierUrnFromClaims(tenantConfig?.claims);
  }

  public getDidDocument(vaultId: string): DidDocument | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didDocument;
  }

  public getDidServiceConfig(vaultId: string): DidService[] | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didConfig.service;
  }

  /**
   * Retrieves the cached DID identifier (`did:web:...`) for a given tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The DID string, or `undefined` if the tenant is not found in the cache.
   */
  public getTenantDid(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    return tenantConfig?.didDocument.id;
  }

  /**
   * Retrieves the cached sector for a given tenant by parsing its canonical URN.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The sector, or `undefined` if the tenant is not found or the URN is malformed.
   */
  public getTenantSector(vaultId: string): Sector | undefined {
    const urn = this.getTenantIdentifierUrn(vaultId);
    if (!urn) return undefined;
    
    const parsedUrn = parseTenantUrn(urn);
    return parsedUrn?.sector as Sector;
  }

  /**
   * Retrieves the cached jurisdiction for a given tenant from its claims.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The jurisdiction string (e.g., 'es'), or `undefined` if not found.
   */
  public getTenantJurisdiction(vaultId: string): string | undefined {
    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (!tenantConfig) return undefined;
    return tenantConfig.claims[ClaimsOrganizationSchemaorg.addressCountry] as string;
  }

  /**
   * Retrieves the canonical service URL for a tenant.
   * It prioritizes the tenant's specified external domain (`url` claim) if it exists.
   * If not, it constructs and returns the fallback hosted URL on the gateway.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The tenant's service URL, or undefined if the tenant is not found.
   */
  public getTenantDomainUrl(vaultId: string): string | undefined {
    if (vaultId === 'host') {
      const hostDidDoc = this.getDidDocument('host');
      return hostDidDoc ? getBaseUrlFromDidWeb(hostDidDoc.id) : undefined;
    }

    const tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (!tenantConfig) {
      return undefined;
    }
    
    const externalUrl = tenantConfig.claims[ClaimsOrganizationSchemaorg.url];
    if (externalUrl) {
      return externalUrl.startsWith('http') ? externalUrl : `https://${externalUrl}`;
    }
    return this.constructHostedUrl(tenantConfig);
  }

  /**
   * Constructs the full hosted URL for a tenant based on its configuration.
   * @param config The full tenant configuration object from the cache.
   */
  private constructHostedUrl(config: any): string | undefined {
    const hostDidDoc = this.getDidDocument('host');
    if (!hostDidDoc) {
      console.error('[TenantsCacheManager] Cannot construct hosted URL: Host DID document not found in cache.');
      return undefined;
    }

    const baseUrl = getBaseUrlFromDidWeb(hostDidDoc.id);

    const alternateName = config.claims[ClaimsOrganizationSchemaorg.alternateName];
    // The URN is the single source of truth for jurisdiction, version, and sector.
    const urn = config.claims[ClaimsOrganizationSchemaorg.identifier];
    const parsedUrn = urn ? parseTenantUrn(urn) : null;

    if (!alternateName || !parsedUrn?.jurisdiction || !parsedUrn?.version || !parsedUrn?.sector) {
      console.warn('[TenantsCacheManager] Cannot construct hosted URL: missing alternateName or could not parse URN.');
      return undefined;
    }
    
    return `${baseUrl}/${alternateName}/cds-${parsedUrn.jurisdiction.toLowerCase()}/${parsedUrn.version}/${parsedUrn.sector}`;
  }
}