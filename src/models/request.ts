// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/request.ts

/**
 * Represents the structured data extracted from an HTTP request path and other properties.
 * This is the foundational context for any incoming job.
 */
export interface DataInRequest {
  fullUrl?: string;
  httpMethod?: string;
  input?: any;
  contentType?: string;
  tenantId?: string;
  jurisdiction?: string;
  apiVersion?: string;
  sectorType?: string;
  /** Corresponds to <sectionTypeOrCompartmentCodingSystem> */
  section?: string;
  /** Corresponds to <formatTypeOrCompartmentCodingValue> */
  format?: string;
  resourceType?: string;
  /** The action without the '_' prefix */
  action?: string;
  language?: string;
}

/**
 * Represents the plaintext of a decoded DIDComm message.
 * This is the core business-level "input" for a job.
 */
export interface DecodedDidcommMessage {
  type: string; // Message Type URI (protocol identifier)
  [key: string]: any;
  
  /** The main content of the message */
  body: any
}

/**
 * Represents the entire data package for a single job ready for processing.
 * It combines the HTTP request context with the decoded message and its security context.
 */
export interface JobRequest extends DataInRequest {
  /** The decoded DIDComm message which constitutes the primary input for the job. */
  input: DecodedDidcommMessage;

  /** Metadata enriched by the security middleware from the cryptographic envelope (JWS/JWE). */
  meta?: {
    jws?: { protected?: Record<string, any>; };
    jwe?: { header?: Record<string, any>; };
    bearer?: { jwt: { header?: Record<string, any>; payload?: Record<string, any>; } }
  };
}
