// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/request.ts

import { ConfidentialStorageDoc, IndexedData } from "./confidential-storage";
import { ProtectedHeadersJWE } from "./jwe";
import { JwsHeader } from "./jws";

export enum FormRequest {
  'OrganizationTerms' = 'register-organization_form_org.schema_v1.0',
  'IndividualTerms' = 'register-individual_form_org.schema_v1.0',
  'EmployeeRole' = 'employee-role_form_org.schema_v1.0',
  'PersonalIdentity' = 'personal-identity_form_org.schema_v1.0',
  'EvidenceEmbedded' = 'evidence-embedded_form_net.openid_v1.0',
}

export interface JobProcessingInfo {
  created?: string;
  requestUrl?: string;
  httpMethod?: string;
  contentType?: string;
  tenantId?: string;
  jurisdiction?: string;
  apiVersion?: string;
  sector?: string;
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
 * Represents the structured data extracted from an HTTP request path and other properties.
 * This is the foundational context for any incoming job in the backend
 */
export interface DataInRequest extends JobProcessingInfo{
  content?: any;
}

/**
 * Represents the entire data package for a single job ready for processing.
 * It combines the HTTP request context with the unprotected message and its security context.
 * The hosted URL has this structure: `https://<host-domain>/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action`
 * The external URL has this structure: `https://<organization-domain>/:section/:format/:resourceType/:action`
 */
export interface JobProcessing extends ConfidentialStorageDoc {
    // 'id' is inherited from RecordBase
    
    /** A number that MUST be incremented each time the document is updated. */
    sequence: number;

    /** Contains an array of indexed attributes protected with HMAC for blind queries. */
    indexed?: IndexedData;
    
    /** The decoded DIDComm message which constitutes the primary input for the job. */
    content: DecodedDidcommMessage;

    /** The JWE representation of the encrypted content. */
    jwe?: Record<string, any>;
}

/**
 * Defines the structure of the cryptographic metadata associated with a job request.
 */
export interface JobDecodedMetadata {
  jws?: {
    protected?: JwsHeader;
    [key: string]: any; // Allow other properties
  };
  jwe?: {
    header?: ProtectedHeadersJWE;
    [key:string]: any; // Allow other properties
  };
  bearer?: {
    compact?: string,
    jwt: {
      header?: JwsHeader;
      payload?: Record<string, any>;
    };
    [key: string]: any; // Allow other properties
  };
  [key: string]: any; // Allow other properties
}

/**
 * Represents the plaintext of a decoded DIDComm message.
 * This is the core business-level "input" for a job.
 */
export interface  DecodedDidcommMessage {
  type: string; // Message Type URI (protocol identifier)
  thid: string; // The Transaction ID for message correlation.
  aud: string;  // The audience of the message.
  [key: string]: any;
  
  /** The main content of the message */
  body: any
}
/**
 * Represents the entire data package for a single job ready for processing.
 * It combines the HTTP request context with the decoded message and its security context.
 * The hosted URL has this structure: `https://<host-domain>/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action`
 * The external URL has this structure: `https://<organization-domain>/:section/:format/:resourceType/:action`
 */
export interface JobRequest extends DataInRequest {
  contentType?: string;
  requestUrl?: string;
  httpMethod?: string;
  tenantId?: string;
  jurisdiction?: string;
  apiVersion?: string;
  sector?: string;
  /** Corresponds to <sectionTypeOrCompartmentCodingSystem> */
  section?: string;
  /** Corresponds to <formatTypeOrCompartmentCodingValue> */
  format?: string;
  resourceType?: string;
  /** The action without the '_' prefix */
  action?: string;
  language?: string;

  /** The decoded DIDComm message which constitutes the primary input for the job. */
  content: DecodedDidcommMessage;

  /** Metadata enriched by the security middleware from the cryptographic envelope (JWS/JWE). */
  meta?: JobDecodedMetadata;
}



