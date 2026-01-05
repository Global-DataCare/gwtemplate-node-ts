// src/services/DiscoveryService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { DidDocument } from '../gdc-backend-utils-node/models/did';
import { JwkSet } from '../gdc-backend-utils-node/models/jwk';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { getBaseUrlFromDidWeb } from '../utils/did-backend';

/**
 * Handles the stateless, synchronous logic for generating public discovery documents
 * like DID Documents and JWKS based on a provided tenant configuration.
 */
export class DiscoveryService {
  private tenantsCacheManager: TenantsCacheManager;

  constructor(tenantsCacheManager: TenantsCacheManager) {
    this.tenantsCacheManager = tenantsCacheManager;
  }

  /**
   * Retrieves the static DID Document for a given tenant.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The DID Document, or undefined if not found.
   */
  public async getDidDocument(vaultId: string): Promise<DidDocument | undefined> {
    return this.tenantsCacheManager.getDidDocument(vaultId);
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) for a given entity.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The JWKS.
   */
  getJwks(vaultId: string): JwkSet {
    // This is a placeholder. A real implementation would fetch public keys 
    // from the KMS, which would require injecting the IKmsService.
    console.warn(`[DiscoveryService] getJwks is returning a placeholder for vaultId: ${vaultId}`);
    return { keys: [] };
  }

  /**
   * Generates a placeholder OpenID Connect configuration.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns A partial OIDC configuration object, or undefined if not found.
   */
  public async getOpenIdConfiguration(vaultId: string): Promise<object | undefined> {
    const didDoc = await this.tenantsCacheManager.getDidDocument(vaultId);
    const tenantUrl = await this.tenantsCacheManager.getTenantDomainUrl(vaultId);

    if (!didDoc || !tenantUrl) return undefined;
    
    const jwksBaseUrl = getBaseUrlFromDidWeb(didDoc.id);
    const jwks_uri = new URL('/.well-known/jwks.json', jwksBaseUrl).toString();
    
    return {
      issuer: tenantUrl,
      jwks_uri: jwks_uri,
    };
  }

  /**
   * Generates a placeholder SMART on FHIR configuration.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns A partial SMART configuration object, or undefined if not found.
   */
  public async getSmartConfiguration(vaultId: string): Promise<object | undefined> {
    const tenantUrl = await this.tenantsCacheManager.getTenantDomainUrl(vaultId);
    if (!tenantUrl) return undefined;

    return {
      issuer: tenantUrl,
      // Additional SMART on FHIR metadata would be populated here.
    };
  }

  /**
   * Generates a placeholder FHIR Capability Statement.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns A partial CapabilityStatement object.
   */
  getCapabilityStatement(vaultId: string): object {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      // The full capability statement would be dynamically generated here.
    };
  }
}
