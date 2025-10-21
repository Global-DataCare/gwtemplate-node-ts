// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/request.ts

import { ProtectedHeadersJWE } from "./jwe";
import { JwsHeader } from "./jws";

export enum FormRequest {
  'OrganizationTerms' = 'register-organization_form_org.schema_v1.0',
  'IndividualTerms' = 'register-individual_form_org.schema_v1.0',
  'EmployeeRole' = 'employee-role_form_org.schema_v1.0',
  'PersonalIdentity' = 'personal-identity_form_org.schema_v1.0',
  'EvidenceEmbedded' = 'evidence-embedded_form_net.openid_v1.0',
}

/**
 * Represents the structured data extracted from an HTTP request path and other properties.
 * This is the foundational context for any incoming job.
 */
export interface DataInRequest {
  requestUrl?: string;
  httpMethod?: string;
  input?: any;
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
  input: DecodedDidcommMessage;

  /** Metadata enriched by the security middleware from the cryptographic envelope (JWS/JWE). */
  meta?: JobRequestMeta;
}

/**
 * Defines the structure of the cryptographic metadata associated with a job request.
 */
export interface JobRequestMeta {
  jws?: {
    protected?: JwsHeader;
    [key: string]: any; // Allow other properties
  };
  jwe?: {
    header?: ProtectedHeadersJWE;
    [key:string]: any; // Allow other properties
  };
  bearer?: {
    jwt: {
      header?: JwsHeader;
      payload?: Record<string, any>;
    };
    [key: string]: any; // Allow other properties
  };
  [key: string]: any; // Allow other properties
}

