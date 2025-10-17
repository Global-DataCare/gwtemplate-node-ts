// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/comm.ts
// Description: Defines the core communication and data structures based on DIDComm and FHIR.

/**
 * Represents the standard payload of a DIDComm v2 message.
 * @see https://identity.foundation/didcomm-messaging/spec/v2.0/#plaintext-message-structure
 */
export interface DidCommPayload {
  id: string;   // Message ID, required.
  type: string; // Message Type URI, required.
  from?: string; // Sender DID
  to?: string[]; // Recipient DIDs
  thid?: string; // Thread ID
  pthid?: string; // Parent Thread ID
  created_time?: number;
  expires_time?: number;
  body: { [key: string]: any };
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
export interface CommMsgExtended extends DidCommPayload {
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
