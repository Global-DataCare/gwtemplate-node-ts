// src/managers/TenantsCacheManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ITenantsManager } from './ITenantsManager';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getIdentifierUrnFromClaims, generateTenantCollectionNameFromClaims } from '../utils/tenant';
import { DidDocument, DidService, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBaseUrlFromDidWeb } from '../utils/did-backend';
import { parseTenantUrn } from '../utils/urn';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantAuthorizationStatus, isTenantAuthorizationOperational, TenantAuthorizationLifecycleStatus } from '../utils/tenant-lifecycle';
import { hasProviderServiceCapabilityClaim } from '../utils/services';

const SERVICE_OPERATIONAL_URL_CLAIM = 'org.schema.Service.url';

/**
 * An in-memory cache implementation of the Tenant Manager.
 * Its primary role is to load all tenant configurations at startup and provide
 * a fast, read-only, and specific lookup for tenant data, acting as a fast
 * ID resolver and service provider. It does not expose the full EntityConfig.
 */
export class TenantsCacheManager implements ITenantsManager {
  private vaultRepository: IVaultRepository;
  private kmsServiceResolver: () => IKmsService;
  private hostCollectionName: string; // The physical collection name for the host
  private tenantCacheByVaultId = new Map<string, any>();
  private get kmsService(): IKmsService {
    return this.kmsServiceResolver();
  }

  constructor(
    vaultRepository: IVaultRepository, 
    kmsServiceResolver: () => IKmsService,
    hostCollectionName: string,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsServiceResolver = kmsServiceResolver;
    this.hostCollectionName = hostCollectionName;
  }

  /**
   * Proactively loads the 'host' configuration into the cache.
   * This is intended to be called at server startup to ensure the host's
   * identity and services are immediately available.
   */
  public async loadHost(): Promise<void> {
    await this._ensureTenantIsInCache('host');
  }


  /**
   * Ensures a tenant's configuration is loaded into the cache.
   * If the tenant is not in the cache, it fetches the record from the host's
   * physical collection, decrypts it, and adds it to the cache.
   *
   * @architecture
   * This method correctly uses the `hostCollectionName` (a physical identifier)
   * to query the repository, upholding the principle that the repository layer
   * is "dumb" and operates only on physical collection names. This manager is
   * responsible for knowing the physical location of the host's tenant registry.
   */
  private async _ensureTenantIsInCache(vaultId: string): Promise<any | undefined> {
    // 1. Check the cache first.
    let tenantConfig = this.tenantCacheByVaultId.get(vaultId);
    if (tenantConfig) {
      return tenantConfig;
    }

    // 2. If not in cache, fetch the tenant's registration record from the HOST'S PHYSICAL collection.
    const secureTenantRecord = await this.vaultRepository.get<ConfidentialStorageDoc>(this.hostCollectionName, vaultId, getEnvSectionId('tenants'));
    
    // 3. If not in the repository, it doesn't exist.
    if (!secureTenantRecord) {
      return undefined;
    }

    try {
      // 4. Decrypt the tenant's configuration.
      tenantConfig = await this.kmsService.unprotectConfidentialData<any>(secureTenantRecord, 'host');

      if (tenantConfig?.claims) {
        // 5. Generate and add the collectionName to the config object.
        const collectionName = generateTenantCollectionNameFromClaims(tenantConfig.claims);
        tenantConfig.collectionName = collectionName;

        // 6. Cache the entire decrypted config for future use.
        this.tenantCacheByVaultId.set(vaultId, tenantConfig);

        return tenantConfig;
      } else {
        console.error(`[TenantsCacheManager] Decrypted record for vaultId '${vaultId}' is invalid or missing claims.`);
        return undefined;
      }
    } catch (error) {
      console.error(`[TenantsCacheManager] Failed to decrypt tenant record for vaultId '${vaultId}'.`, error);
      return undefined;
    }
  }

  /**
   * Retrieves the full, cached configuration for a tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The tenant's configuration object, or `undefined` if not found.
   */
  public async getTenant(vaultId: string): Promise<any | undefined> {
    return await this._ensureTenantIsInCache(vaultId);
  }

  public async refreshTenant(vaultId: string): Promise<any | undefined> {
    this.tenantCacheByVaultId.delete(vaultId);
    return await this._ensureTenantIsInCache(vaultId);
  }

  /**
   * Resolves the canonical tenant vault id from an organization identifier value
   * (e.g. VAT/TAX id stored in `Organization.identifier.value`).
   */
  public async findTenantVaultIdByIdentifierValue(identifierValue: string): Promise<string | undefined> {
    const target = String(identifierValue || '').trim();
    if (!target || target.toLowerCase() === 'host') return undefined;

    const tenantsSection = getEnvSectionId('tenants');
    const records = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(this.hostCollectionName, tenantsSection);
    for (const record of records) {
      try {
        const config = await this.kmsService.unprotectConfidentialData<any>(record, 'host');
        const current = String(config?.claims?.[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
        if (current && current === target) {
          const collectionName = generateTenantCollectionNameFromClaims(config.claims);
          config.collectionName = collectionName;
          this.tenantCacheByVaultId.set(record.id, config);
          return record.id;
        }
      } catch {
        // Skip malformed tenant records.
      }
    }
    return undefined;
  }

  /**
   * Returns all tenant configurations currently registered in the host tenant registry.
   * This is intended for operator-level discovery/catalog publication flows.
   */
  public async listRegisteredTenants(): Promise<any[]> {
    const tenantsSection = getEnvSectionId('tenants');
    const records = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(this.hostCollectionName, tenantsSection);
    const tenants: any[] = [];

    for (const record of records) {
      try {
        const config = await this.kmsService.unprotectConfidentialData<any>(record, 'host');
        if (!config?.claims || !config?.didDocument?.id) continue;
        const collectionName = generateTenantCollectionNameFromClaims(config.claims);
        config.collectionName = collectionName;
        const vaultId = record.id;
        this.tenantCacheByVaultId.set(vaultId, config);
        tenants.push(config);
      } catch {
        // Skip malformed/unreadable tenant records in discovery output.
      }
    }
    return tenants;
  }

  /**
   * Returns only tenants that are both operational and provider-capable.
   * This is the discovery surface used by host autodiscovery catalogs.
   */
  public async listAutodiscoverableTenants(): Promise<any[]> {
    const tenants = await this.listRegisteredTenants();
    return tenants.filter((tenant) => {
      const serviceCapabilityClaim = tenant?.claims?.[ClaimsServiceSchemaorg.serviceType] as string | undefined;
      return isTenantAuthorizationOperational(tenant) && hasProviderServiceCapabilityClaim(serviceCapabilityClaim);
    });
  }

  /**
   * Retrieves the physical collection name for a given logical vaultId.
   * This is the primary method for business managers to resolve the storage location for a tenant.
   * @param vaultId The unique vault identifier for the tenant (e.g., 'host', 'health-care_acme').
   * @returns The tenant's physical collection name (e.g., 'host', 'ES_TAX_B12345..._health-care'), or `undefined` if not found.
   */
  public async getCollectionName(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.collectionName;
  }

  public async getTenantAuthorizationStatus(vaultId: string): Promise<TenantAuthorizationLifecycleStatus | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return undefined;
    }
    return getTenantAuthorizationStatus(tenantConfig);
  }

  public async isTenantOperational(vaultId: string): Promise<boolean> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return false;
    }
    return isTenantAuthorizationOperational(tenantConfig);
  }

  /**
   * Finds a tenant in the cache by their full DID identifier.
   * @param did The `did:web:...` identifier of the tenant.
   * @returns The tenant's configuration object, or `undefined` if no tenant matches the DID.
   */
  // TODO: Refactor findTenantByDid for the new async, on-demand caching architecture.
  // This synchronous implementation is no longer reliable as it only searches tenants already in the cache.
  public findTenantByDid(did: string): any | undefined {
    // for (const tenantConfig of this.tenantCacheByVaultId.values()) {
    //   if (tenantConfig.didDocument?.id === did) {
    //     return tenantConfig;
    //   }
    // }
    return undefined;
  }

  /**
   * Finds a tenant in the cache where the tenant's DID is a prefix of the provided DID.
   * This is used to resolve an employee or individual's DID back to their parent tenant
   * when the DID is from an external domain.
   * @param did The `did:web:...` identifier of the entity (e.g., an employee).
   * @returns The tenant's configuration object, or `undefined` if no tenant matches.
   */
  // TODO: Refactor findTenantByDidPrefix for the new async, on-demand caching architecture.
  // This synchronous implementation is no longer reliable as it only searches tenants already in the cache.
  public findTenantByDidPrefix(did: string): any | undefined {
    // // Find the tenant whose DID is the longest matching prefix of the given DID.
    // let bestMatch: any | undefined;
    // let longestPrefix = 0;

    // for (const tenantConfig of this.tenantCacheByVaultId.values()) {
    //   const tenantDid = tenantConfig.didDocument?.id;
    //   if (tenantDid && did.startsWith(tenantDid)) {
    //     if (tenantDid.length > longestPrefix) {
    //       longestPrefix = tenantDid.length;
    //       bestMatch = tenantConfig;
    //     }
    //   }
    // }
    // return bestMatch;
    return undefined;
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
  public async getTenantIdentifierUrn(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return getIdentifierUrnFromClaims(tenantConfig?.claims);
  }

  public async getDidDocument(vaultId: string): Promise<DidDocument | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didDocument;
  }

  public async getDidServiceConfig(vaultId: string): Promise<DidService[] | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didConfig?.service;
  }

  /**
   * Retrieves the cached DID identifier (`did:web:...`) for a given tenant.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The DID string, or `undefined` if the tenant is not found in the cache.
   */
  public async getTenantDid(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.didDocument?.id;
  }

  /**
   * Retrieves the cached claims for a given entity configuration.
   * Note: In this manager, it specifically resolves tenant entities.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The claims object, or `undefined` if not found.
   */
  public async getEntityClaims(vaultId: string): Promise<any | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    return tenantConfig?.claims;
  }

  /**
   * Retrieves the cached sector for a given tenant by parsing its canonical URN.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The sector, or `undefined` if the tenant is not found or the URN is malformed.
   */
  public async getTenantSector(vaultId: string): Promise<Sector | undefined> {
    const urn = await this.getTenantIdentifierUrn(vaultId);
    if (!urn) return undefined;
    
    const parsedUrn = parseTenantUrn(urn);
    return parsedUrn?.sector as Sector;
  }

  /**
   * Retrieves the cached jurisdiction for a given tenant from its claims.
   * @param vaultId The unique vault identifier for the tenant.
   * @returns The jurisdiction string (e.g., 'es'), or `undefined` if not found.
   */
  public async getTenantJurisdiction(vaultId: string): Promise<string | undefined> {
    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
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
  public async getTenantDomainUrl(vaultId: string): Promise<string | undefined> {
    if (vaultId === 'host') {
      const hostDidDoc = await this.getDidDocument('host');
      return hostDidDoc ? getBaseUrlFromDidWeb(hostDidDoc.id) : undefined;
    }

    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return undefined;
    }
    
    const externalUrl = tenantConfig.claims[ClaimsOrganizationSchemaorg.url];
    if (externalUrl) {
      return externalUrl.startsWith('http') ? externalUrl : `https://${externalUrl}`;
    }
    return await this.constructHostedUrl(tenantConfig);
  }

  /**
   * Retrieves the operational base URL for a tenant.
   * This URL is intended for direct API invocation (`didDocument.service[].serviceEndpoint`).
   */
  public async getTenantOperationalUrl(vaultId: string): Promise<string | undefined> {
    if (vaultId === 'host') {
      const hostDidDoc = await this.getDidDocument('host');
      return hostDidDoc ? getBaseUrlFromDidWeb(hostDidDoc.id) : undefined;
    }

    const tenantConfig = await this._ensureTenantIsInCache(vaultId);
    if (!tenantConfig) {
      return undefined;
    }

    const operationalUrl = tenantConfig.claims[SERVICE_OPERATIONAL_URL_CLAIM];
    if (typeof operationalUrl === 'string' && operationalUrl.trim()) {
      return operationalUrl.startsWith('http') ? operationalUrl : `https://${operationalUrl}`;
    }

    return await this.constructHostedUrl(tenantConfig);
  }

  /**
   * Constructs the full hosted URL for a tenant based on its configuration.
   * @param config The full tenant configuration object from the cache.
   */
  private async constructHostedUrl(config: any): Promise<string | undefined> {
    const hostDidDoc = await this.getDidDocument('host');
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
