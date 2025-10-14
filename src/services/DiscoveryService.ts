// src/services/DiscoveryService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../models/entity';
import { DidDocument } from '../models/did';
import { JwkSet } from '../models/jwk';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';

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
  getDidDocument(vaultId: string): DidDocument | undefined {
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
  getOpenIdConfiguration(vaultId: string): object | undefined {
    const didDoc = this.tenantsCacheManager.getDidDocument(vaultId);
    const tenantUrl = this.tenantsCacheManager.getTenantDomainUrl(vaultId);

    if (!didDoc || !tenantUrl) return undefined;
    
    // The jwks_uri path needs to be updated to match the new routing structure.
    // This now correctly uses the tenant's primary DID as the base.
    const jwks_uri = new URL('/.well-known/jwks.json', didDoc.id.replace('did:web:', 'https://')).toString();
    
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
  getSmartConfiguration(vaultId: string): object | undefined {
    const tenantUrl = this.tenantsCacheManager.getTenantDomainUrl(vaultId);
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