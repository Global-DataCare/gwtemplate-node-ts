// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/entity.ts

import { DidService } from "./did";
import { ParamAttribute } from "./params";
import { RecordBase } from "./resource-document";

export interface EntityUrnBaseParams {
  namespace: string;
  network: 'test-network';
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
 * Represents the fundamental data payload for any configurable entity.
 * It separates the core identity information from operational or cryptographic configurations.
 */
export interface BasicInput extends RecordBase {
  // The internal `id` (e.g., UUID v4) is inherited from RecordBase.

  /**
   * A string that acts as an internal type discriminator.
   * @example 'TenantConfig', 'CustomerConfig'
   */
  type: string;

  /**
   * A structured object for primary, single-value, and sensitive personal information.
   * This field typically holds the core, defining attributes of an entity, such as
   * date of birth or gender, which are not meant for frequent searching and do not
   * typically have multiple values. The keys are reverse-DNS claims.
   *
   * @example { 'org.schema.Person.birthDate': '1990-01-15' }
   */
  claims: object;

  /**
   * An array for storing secondary, multi-value, or complex attributes in their
   * original, human-readable plaintext format. This field is inspired by the
   * FHIR Parameters resource for future interoperability.
   *
   * Its primary purpose is to hold the readable versions of identifiers (like emails,
   * phone numbers, or official document numbers) that are also stored as HMACs in
   * a separate `indexedAttributes` dictionary for secure verification. This is the
   * **only** place from which the system can retrieve the original value of such an identifier.
   *
   * The entire `parameters` array is encrypted at rest within its parent configuration object.
   *
   * @see {ParamAttribute}
   * @example
   * [
   *   { name: 'NNES', value: '12345678X' },
   *   { name: 'email', value: 'secondary.email@example.com' }
   * 
   */
  parameters?: ParamAttribute[];
}

/**
 * Represents the full, authoritative configuration for a single operational entity,
 * such as a Tenant or a Customer.
 *
 * This object extends the basic identity data with cryptographic materials (DIDs),
 * operational status, and other metadata required for the entity to function within the system.
 * The entire object is typically stored within a `ConfidentialStorageDoc` and encrypted at rest.
 */
export interface EntityConfig extends BasicInput {
  /**
   * The configuration for the services section of the DID Document, defining
   * only the service endpoints configuration which is then multiplexed in the public didDocument
   */
  didConfig: {
    service: DidService[];
  };

  /**
   * The authoritative DID Document for the entity, which is constructed using
   * information from this configuration. It contains all public keys, service
   * endpoints, and other essential metadata.
   */
  didDocument: {
    '@context': string | string[];
    id: string; // The public DID (e.g., 'did:web:...')
    [key: string]: any;
  };

  /**
   * The current operational status of the entity's account.
   */
  status: 'active' | 'disabled';
}