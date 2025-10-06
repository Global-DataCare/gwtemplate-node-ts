// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/tenant.ts

import { DidService } from "./did";
import { RecordBase } from "./resource-document";

export interface EntityUrnBaseParams {
  namespace: string;
  network: string;
  jurisdiction: string;
  version?: string;
  sector: string;
}

export interface OrganizationUrnParams extends EntityUrnBaseParams {
  idType: string;
  idValue: string;
}

export interface EmployeeUrnParams extends OrganizationUrnParams {
  email: string;
  role: string;
}

/**
 * Represents the full configuration for a single tenant.
 * This object is stored in the 'host' vault and can be cached.
 */
export interface EntityConfig extends RecordBase {
  // `id` is inherited from RecordBase
  type: string;

  /** Claims from form data and URN as `identifier` */
  claims: object, // reverse-DNS claims from schema.org or fhir.hl7.org

  /**
   * The configuration of services for the DID Document for the tenant, containing all public keys,
   * service endpoints, and other essential metadata.
   */
  didConfig: {
    service: DidService[]
  };

  /**
   * The authoritative DID Document for the tenant, containing all public keys,
   * service endpoints, and other essential metadata.
   */
  didDocument: {
    '@context': string | string[];
    id: string;
    [key: string]: any;
  };

  /** The current status of the employee's account. */
  status: 'active' | 'disabled';  
}
