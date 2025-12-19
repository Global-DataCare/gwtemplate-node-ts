/**
 * @file src/models/confidential-message.ts
 * @copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
 *
 * @summary
 * This file defines the core structures for confidential messages, primarily based on
 * the DIDComm v2 specification. These models represent the plaintext content that is
 * typically encrypted within a JWE and/or signed within a JWS.
 *
 * @architecture
 * 1.  **`IDecodedDidcommPayload`**: This is the canonical structure of a plaintext message
 *     received from a client. It contains standard JWT claims (`iss`, `aud`, `jti`, etc.)
 *     for security and DIDComm fields (`thid`, `type`) for message correlation and
 *     protocol definition.
 *
 * 2.  **`body`**: The most important property of the payload. For all primary business
 *     workflows in this system, the `body` is expected to be a `BundleJsonApi` object
 *     (as defined in `src/models/bundle.ts`). This is where the array of `BundleEntry`
 *     objects resides, each representing a single unit of work.
 *
 * 3.  **`IPayloadResponse`**: The structure that all business logic managers (e.g.,
 *     `HostingManager`) MUST return from their `process` method. It extends the base
 *     payload, enforcing the presence of critical JWT time-based claims (`exp`, `nbf`, `iat`)
 *     for auditable, secure responses. The `body` of the response is also a `BundleJsonApi`,
 *     containing the results of the processed entries.
 */

import { BundleJsonApi } from "./bundle";
import { ProtectedHeadersJWE } from "./jwe";
import { JwsHeader } from "./jws";


/**
 * Defines the structure of the cryptographic metadata associated with a job request.
 */
export interface DidCommDecodedMetadata {
  jws?: {
    protected?: JwsHeader;
    signature?: string; // Base64url encoded
  };
  jwe?: {
    header?: ProtectedHeadersJWE;
  };
  bearer?: {
    compact?: string,
    jwt: {
      header?: JwsHeader;
      payload?: Record<string, any>;
      signature?: string; // Base64url encoded
    };
  };
}

/**
 * Represents the standard payload of a DIDComm v2 message.
 * @see https://identity.foundation/didcomm-messaging/spec/v2.0/#plaintext-message-structure
 */
/**
 * Represents the plaintext of a decoded DIDComm message.
 * This is the core business-level "input" for a job.
 * For FAPI compliance, this entire object is typically the payload of a signed JWS.
 */
export interface IDecodedDidcommPayload {

  /** Relevant information available through the decryption and verification process */
  meta?: DidCommDecodedMetadata;

  // --- FAPI & JWT Core Claims ---
  
  /**
   * (Issuer) The DID of the entity that issued the message.
   * REQUIRED for FAPI. MUST match the signer of the enclosing JWS.
   */
  iss: string;

  /**
   * (Audience) The URL of the backend endpoint that will process this message.
   * REQUIRED for FAPI. The backend MUST validate that this value matches its own URL.
   */
  aud: string;

  /** (Expiration Time) Timestamp after which the message is considered invalid. REQUIRED for FAPI (instead of expires_time). */
  exp?: number;

  /** (Not Before) Timestamp before which the message must not be processed. REQUIRED for FAPI (instead of created_time). */
  nbf?: number;

  /** (Issued At) Timestamp when the message was issued. REQUIRED for FAPI. */
  iat?: number;
  
  /**
   * (JWT ID) A unique identifier for this message/token. Can be used to prevent replay attacks.
   * In our architecture, this can also serve as the version hash of the content.
   */
  jti: string;

  // --- DIDComm Core Fields ---
  
  /** The Transaction ID / Thread ID for message correlation across an interaction. */
  thid: string;

  /**  Parent Thread ID */
  pthid?: string; 

  /** The DID of the intended recipient. Used for P2P messaging, informational in client-server requests. */
  to?: string[];
  
  /** The DID of the sender. Used for P2P messaging, but `iss` is the authoritative value for FAPI. */
  from?: string;

  /**
   * The Message Type URI, identifying the type of data in the body or protocol used.
   * (e.g. 'application/json') 
  */
  type: string;

  // --- JARM (JWT Secured Authorization Response Mode) Parameters ---
  // These fields are placed at the top level of the DIDComm message to govern the
  // protocol of the response, making the system transport-agnostic, as per FAPI.

  /**
   * (Optional) Specifies how the Authorization Response should be returned. If present,
   * indicates the client expects a JARM-compliant response.
   * @example "query.jwt", "form_post.jwt"
   */
  response_mode?: string,

  /**
   * (Optional) In a JARM context, specifies the content type of the data within
   * the final response JWT. If it includes "fhir+json", a FHIR Bundle is expected.
   * @example "token id_token fhir+json"
   */
  response_type?: string;

  /**
   * The main business payload of the message. For most operations in this system,
   * this MUST be a `BundleJsonApi` object. The structure within the bundle is
   * defined by the 'type' protocol of the message.
   */
  body: BundleJsonApi | any;
}

/**
 * Defines the structure of the plaintext response payload that a manager MUST return.
 * This extends the generic DIDComm payload with stricter, FAPI-compliant requirements
 * for auditable, secure responses.
 *
 * TODO: Before production release, `exp`, `nbf`, and `iat` MUST be made mandatory
 * and all manager `process` methods must be updated to return these fields.
 */
export interface IPayloadResponse extends IDecodedDidcommPayload {
  /**
   * (Expiration Time) REQUIRED for a response. Timestamp after which the response is invalid.
   */
  exp?: number;

  /**
   * (Not Before) REQUIRED for a response. Timestamp before which the response must not be processed.
   */
  nbf?: number;

  /**
   * (Issued At) REQUIRED for a response. Timestamp when the response was issued.
   */
  iat?: number;
}

/**
 * Represents a data entry in the `body` of a CommMsgExtended,
 * following a hybrid JSON:API and FHIR structure.
 */
export interface DataEntry {
  id: string;
  type: 'Annotation' | 'Reference' | 'Attachment' | 'CodeableConcept' | string;
  resource: { [key: string]: any };
  meta?: {
    claims: any;
  }
}

/**
 * The canonical, internal representation of a secure message, extending
 * the standard DIDComm payload with FHIR-specific, flattened metadata.
 */
export interface ICommPayloadExtended extends IDecodedDidcommPayload {
  // Overriding body for a more specific structure
  body: {
    data: DataEntry[];
  };

  // FHIR Communication resource fields, flattened for use as metadata or search parameters.
  // These are derived from the source FHIR resource during conversion.
  
  // 'status'?: string; // e.g., 'completed', 'in-progress'
  // 'statusReason'?: string; // Flattened from CodeableConcept
  // 'partOf'?: string; // Comma-separated list of URNs/URLs
  // 'basedOn'?: string; // Comma-separated list of URNs/URLs
  // 'inResponseTo'?: string; // Comma-separated list of URNs/URLs
  // 'priority'?: string; // e.g., 'routine', 'urgent'
  // 'topic'?: string; // Flattened from CodeableConcept
  // 'medium'?: string; // Flattened from CodeableConcept
  // 'about'?: string; // Comma-separated list of URNs/URLs
  // 'encounter'?: string; // URN or URL
}

/**
 * A type placeholder for a FHIR Communication resource.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FhirCommunication = any;
