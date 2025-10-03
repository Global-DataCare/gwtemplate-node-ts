// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/tenant.ts

import { DidService } from "./did";
import { RecordBase } from "./resource-document";
import { Sector } from "./sector";

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
export interface TenantConfig extends RecordBase {
  // `id` is inherited from RecordBase
  claims: {
  }
  
  /**
   * Public-facing identifier, used in URLs. e.g., 'org1'
   */
  alternateName: string;

  /**
   * Official, registered name.
   */
  legalName: string;

  /**
   * The public identifier (e.g., the URN).
   */
  identifier: string;

  /**
   * Contextual information for database collections.
   */
  sector: Sector;
  jurisdiction: string;

  /**
   * The public URL where the DID document can be resolved (for the sector and jurisdiction).
   */
  url: string;

  /**
   *  Type of entity: e.g. Hospital, Clinic, Employee...
   */
  additionalType?: string;

  /**
   * The configuration of services for the DID Document for the tenant, containing all public keys,
   * service endpoints, and other essential metadata.
   */
  didConfig: {
    '@context': string | string[];
    id: string;
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
}
