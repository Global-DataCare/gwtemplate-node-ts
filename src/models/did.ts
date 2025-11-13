// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/did.ts

import { PublicJwk } from "../crypto/interfaces/Cryptography.types";
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
    /** Public keys used for verifying digital signatures */
    verificationMethod?: VerificationMethod[];
    /** 
     * Specifies verification methods for making claims. Can be embedded or a string referencing a `verificationMethod`.
     * @see https://www.w3.org/TR/did-core/#assertion
     */
    assertionMethod?: (string | VerificationMethod)[]; 
    /** 
     * Specifies methods for authentication. Can be embedded or a string referencing a `verificationMethod`.
     * @see https://www.w3.org/TR/did-core/#authentication
     */
    authentication?: (string | VerificationMethod)[]; 
    /** 
     * Specifies methods for key agreement. Can be embedded or a string referencing a `verificationMethod`.
     * @see https://www.w3.org/TR/did-core/#key-agreement
     */
    keyAgreement?: (string | VerificationMethod)[];
    /** Service endpoints for interacting with the entity */    
    service?: DidService[];
    /** Other properties are allowed. */
    [key: string]: any;
}

// En src/models/did.ts (o donde esté RecipientPublicKey/VerificationMethod)
export interface VerificationMethod extends RecipientPublicKey {
  id: string; // e.g., did:web:example.com#key-1
  type: string; // e.g., JsonWebKey2020
  controller: string; // e.g., did:web:example.com
  publicKeyJwk: PublicJwk;
}