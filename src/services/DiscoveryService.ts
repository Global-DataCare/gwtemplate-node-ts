// src/services/DiscoveryService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { TenantConfig } from '../models/tenant';
import { DidDocument } from '../models/did';
import { JwkSet } from '../models/jwk';

/**
 * Handles the synchronous logic for retrieving public discovery documents like
 * DID Documents and JWKS, as specified in SYSTEM_DESIGN.md.
 */
export class DiscoveryService {
  constructor(private tenantsCacheManager: TenantsCacheManager) {}

  /**
   * Retrieves the DID Document for a given entity (tenant or host).
   * @param tenantId The alternateName of the entity.
   * @returns The DID Document or null if not found.
   */
  async getDidDocument(tenantId: string): Promise<DidDocument | null> {
    const config = await this.tenantsCacheManager.getConfigByAlternateName(tenantId);
    return config?.didDocument || null;
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) for a given entity.
   * @param tenantId The alternateName of the entity.
   * @returns The JWKS or null if not found.
   */
  async getJwks(tenantId: string): Promise<JwkSet | null> {
    const config = await this.tenantsCacheManager.getConfigByAlternateName(tenantId);
    if (!config) return null;
    
    // In a real implementation, this would retrieve public keys from the KMS.
    // For now, it returns a placeholder.
    return { keys: [] };
  }

  /**
   * Generates a placeholder OpenID Connect configuration.
   * @param config The configuration of the tenant.
   * @returns A partial OIDC configuration object.
   */
  getOpenIdConfiguration(config: TenantConfig): object {
    return {
      issuer: config.url,
      jwks_uri: `${config.url}/.well-known/jwks.json`,
      // Additional OIDC metadata would be populated here.
    };
  }

  /**
   * Generates a placeholder SMART on FHIR configuration.
   * @param config The configuration of the tenant.
   * @returns A partial SMART configuration object.
   */
  getSmartConfiguration(config: TenantConfig): object {
    return {
      issuer: config.url,
      // Additional SMART on FHIR metadata would be populated here.
    };
  }

  /**
   * Generates a placeholder FHIR Capability Statement.
   * @param config The configuration of the tenant.
   * @returns A partial CapabilityStatement object.
   */
  getCapabilityStatement(config: TenantConfig): object {
    return {
      resourceType: "CapabilityStatement",
      status: "active",
      // The full capability statement would be dynamically generated here.
    };
  }
}
