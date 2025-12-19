/**
 * @file src/models/confidential-job.ts
 * @copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
 *
 * @summary
 * This file defines the canonical data structure for a "Job" as it exists within the
 * asynchronous processing pipeline (e.g., in the queue and the worker).
 *
 * @architecture
 * The `JobRequest` model is the central data carrier for workers. It combines the
 * original request payload with contextual information derived from the API endpoint URL.
 *
 * 1.  **`JobProcessingInfo`**: Contains context from the API URL path, such as `tenantId`,
 *     `sector`, `resourceType`, and `action`. This allows the worker to operate
 *     without needing to know about the API's routing structure.
 *
 * 2.  **`JobRequest`**: The full job object.
 *     - It extends `ConfidentialStorageDoc`, giving it properties like `id` and `sequence`.
 *     - It includes `JobProcessingInfo` for the routing context.
 *     - **`content`**: This is the most critical property. It holds the `IDecodedDidcommPayload`,
 *       which is the entire decrypted and verified payload from the original client request.
 *       The `content.body` property contains the `BundleJsonApi` that the worker must process.
 */

import { IDecodedDidcommPayload } from "./confidential-message";
import { ConfidentialStorageDoc, IndexedData } from "./confidential-storage";


export enum FormRequest {
  'OrganizationTerms' = 'register-organization_form_org.schema_v1.0',
  'IndividualTerms' = 'register-individual_form_org.schema_v1.0',
  'EmployeeRole' = 'employee-role_form_org.schema_v1.0',
  'PersonalIdentity' = 'personal-identity_form_org.schema_v1.0',
  'EvidenceEmbedded' = 'evidence-embedded_form_net.openid_v1.0',
}

export interface JobProcessingInfo {
  /** The Unix epoch timestamp (in milliseconds) of when the job record was created. */
  createdAtTimestamp: number;
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
 * Defines the possible statuses of a job throughout its lifecycle.
 */
export enum JobStatus {
  /** The job has been created locally but not yet submitted. */
  DRAFT = 'DRAFT',
  /** The job is in the process of being submitted to the server. */
  SUBMITTING = 'SUBMITTING',
  /** The job was successfully submitted and is awaiting asynchronous processing. */
  SENT = 'SENT',
  /** The server has finished processing the job and returned a final result. This is a terminal state. */
  COMPLETED = 'COMPLETED',
  /** The job failed due to a transport-level error and will not be retried. This is a terminal state. */
  FAILED = 'FAILED',
  /** The job failed due to a transient error and may be retried. */
  ERROR_RETRYABLE = 'ERROR_RETRYABLE',
}

/**
 * Represents the entire data package for a single job ready for processing by a Worker.
 * It combines the HTTP request context with the unprotected DIDComm message payload.
 *
 * @property {IDecodedDidcommPayload} [content] - The core of the job. This is the fully
 *   decrypted and verified DIDComm message from the original request. The worker's
 *   primary task is to process the `BundleJsonApi` located in `content.body`.
 * @property {string} [contentType] - The `Content-Type` header from the original HTTP
 *   request (e.g., 'application/x-www-form-urlencoded'). This is preserved so the
 *   polling endpoint can determine whether to respond with a plaintext JSON object or
 *   an encrypted JWE.
 */
export interface JobRequest extends ConfidentialStorageDoc, JobProcessingInfo {
    // 'id' serves as the primary key in the vault.
    id: string;
    status: JobStatus;
    versionId?: string;
    vaultId?: string;
    chunks?: number;

    // From ConfidentialStorageDoc

    /** A number that MUST be incremented each time the document is updated. */
    sequence: number;

    /** Contains an array of indexed attributes protected with HMAC for blind queries. */
    indexed?: IndexedData;
    
    /** The decoded DIDComm message. Present when the job is unprotected. */
    content?: IDecodedDidcommPayload;

    /** The JWE representation of the encrypted content. Present when the job is protected. */
    jwe?: Record<string, any>;

    // Additional information for job processing

    /** Addtional information from HTTP header */
    onBehalfOf?: string;

    /** The URL provided by the server to poll for the job's status. */
    locationUrl?: string;

    /** A counter for the number of retry attempts. */
    retryCount?: number;

    /** The ID of the corresponding response message stored in the vault, once the job is COMPLETED. */
    responseMessageId?: string;

    /** CAUTION: Only for debugging purposes. It is the last error message, o*/
    errorMessage?: string;
}


