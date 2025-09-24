// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/did.ts

import { RecipientPublicKey } from "./crypto";

/**
 * Defines the components of a DID Document Service ID for path-based validation.
 * This structure is used to programmatically build and parse service IDs.
 */
export interface DidServiceIdParts {
  version: string;
  sector: string;
  section: string;
  format: string;
}

/**
 * Represents a service endpoint in a DID Document.
 * @see https://www.w3.org/TR/did-core/#service-endpoints
 */
export interface DidService {
    id: string;
    type: string;
    serviceEndpoint: string | string [];
    [key: string]: any; // Allow for additional properties
}

/**
 * Represents a DID Document, compliant with the W3C DID Core specification.
 * It describes how to use a DID, including verification methods and service endpoints.
 * @see https://www.w3.org/TR/did-core/
 */
export interface DidDocument {
    /** The DID context, typically "https://www.w3.org/ns/did/v1". */
    '@context': string | string[];
    /** The DID URI itself. */
    id: string;
    /** Public keys used for verifying digital signatures. */
    verificationMethod?: RecipientPublicKey[];
    /** Public keys used for encryption. */
    keyAgreement?: RecipientPublicKey[];
    /** Service endpoints for interacting with the DID subject. */
    service?: DidService[];
    /** Other properties are allowed. */
    [key: string]: any;
}
