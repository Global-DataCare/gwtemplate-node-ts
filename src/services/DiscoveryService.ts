// src/services/DiscoveryService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../models/entity';
import { DidDocument } from '../models/did';
import { JwkSet } from '../models/jwk';

/**
 * Handles the stateless, synchronous logic for generating public discovery documents
 * like DID Documents and JWKS based on a provided tenant configuration.
 */
export class DiscoveryService {
  /**
   * Retrieves the static DID Document from a given tenant configuration.
   * @param tenantConfig The fully resolved configuration of the tenant.
   * @returns The DID Document.
   */
  getDidDocument(tenantConfig: EntityConfig): DidDocument {
    return tenantConfig.didDocument;
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) for a given entity.
   * @param tenantConfig The fully resolved configuration of the tenant.
   * @returns The JWKS.
   */
  getJwks(tenantConfig: EntityConfig): JwkSet {
    // In a real implementation, this would retrieve public keys from the KMS
    // or reference them from the DID Document's verificationMethod.
    // For now, it returns a placeholder.
    return { keys: [] };
  }

  /**
   * Generates a placeholder OpenID Connect configuration.
   * @param config The configuration of the tenant.
   * @returns A partial OIDC configuration object.
   */
  getOpenIdConfiguration(config: EntityConfig): object {
    return {
      issuer: config.url,
      // The jwks_uri path needs to be updated to match the new routing structure
      jwks_uri: `${config.url}/cds-${config.jurisdiction}/v1/${config.sector}/.well-known/jwks.json`,
    };
  }

  /**
   * Generates a placeholder SMART on FHIR configuration.
   * @param config The configuration of the tenant.
   * @returns A partial SMART configuration object.
   */
  getSmartConfiguration(config: EntityConfig): object {
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
  getCapabilityStatement(config: EntityConfig): object {
    return {
      resourceType: 'CapabilityStatement',
      status: 'active',
      // The full capability statement would be dynamically generated here.
    };
  }
}