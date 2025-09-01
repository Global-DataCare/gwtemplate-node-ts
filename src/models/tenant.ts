// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/tenant.ts

import { RecordBase } from "./resource-document";

/**
 * Represents the full configuration for a single tenant.
 * This object is stored in the 'host' vault and can be cached.
 */
export interface TenantConfig extends RecordBase {
  // `id` is inherited from RecordBase
  
  /**
   * Public-facing identifier, used in URLs. e.g., 'org1'
   */
  alternateName: string;

  /**
   * Official, registered name.
   */
  legalName: string;

  /**
   * The public identifier (e.g., 'taxID|B12345678').
   */
  identifier: string;

  /**
   * The public URL where the DID document can be resolved.
   */
  url: string;

  /**
   * Contextual information for database collections.
   */
  sector: string;
  jurisdiction: string;

  /**
   * The authoritative DID Document for the tenant, containing all public keys,
   * service endpoints, and other essential metadata.
   */
  didDocument: {
    '@context': string | string[];
    id: string;
    [key: string]: any;
  };

  /**
   *  For URN generation
   */
  additionalType?: string;
}
