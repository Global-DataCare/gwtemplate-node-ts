/**
 * @file src/models/bundle.ts
 * @copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
 *
 * @summary
 * This file defines the canonical data structures for "Bundles" and their "Entries"
 * within this system, following a hybrid FHIR / JSON:API pattern. It is the single
 * source of truth for the shape of request and response bodies.
 *
 * @architecture
 * The models herein are critical for maintaining architectural consistency.
 *
 * 1.  **`BundleJsonApi`**: The top-level container for all batch operations. Corresponds
 *     to the `body` of a DIDComm message or a standard API request.
 *
 * 2.  **`BundleEntry`**: The core component of a Bundle. Represents a single unit of work,
 *     such as registering one organization or creating one employee. It has a strict
 *     structure:
 *     - `type`: A string that defines the business action (e.g., 'Organization-registration-offer-v1.0').
 *     - `meta`: A **TOP-LEVEL** property containing the original `claims` for the operation.
 *               This is crucial for both processing and error reporting.
 *     - `resource`: A FHIR-like resource object that is the subject of the action. It
 *                   contains the structured data derived from the claims.
 *     - `request`/`response`: Contextual objects indicating the operation's details or result.
 */

import { OperationOutcome } from "./fhir/operation-outcome";

// ===================================================================================
// BUNDLE ENTRY COMPONENTS
// ===================================================================================

/**
 * Defines the `request` property for an entry in a request Bundle.
 * This indicates the intended action for the entry.
 */
export interface BundleRequest {
  method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  url: string;
}

/**
 * Defines the `response` property for an entry in a response Bundle.
 * This indicates the outcome of the action for the entry.
 */
export interface BundleResponse {
  /** The HTTP status code as a string (e.g., "201", "404"). */
  status: string;
  [key: string]: any;
}

/**
 * Defines the `meta` property that holds the original, unprocessed claims for a BundleEntry.
 * This ensures that the complete context of a request is preserved through the entire
 * asynchronous workflow and is available for error reporting.
 */
export interface BundleEntryMeta {
  /** The original, flattened claims record for this specific entry. */
  claims?: Record<string, any>;
}

// ===================================================================================
// BUNDLE ENTRY TYPES
// ===================================================================================

/**
 * @deprecated Use `BundleEntry` instead. This will be removed in a future version.
 * Represents a single entry in an INCOMING request Bundle.
 */
export interface BundleEntryRequest {
  id?: string;
  type: string;
  request: BundleRequest;
  resource?: Record<string, any>;
  meta?: BundleEntryMeta;
}

/**
 * @deprecated Use `BundleEntry` instead. This will be removed in a future version.
 * Represents a single successful entry in an OUTGOING response Bundle.
 */
export interface BundleEntryResponse {
  id?: string;
  type: string;
  response: BundleResponse;
  resource?: Record<string, any>;
  meta?: BundleEntryMeta;
}

/**
 * Represents a single error entry in a response Bundle.
 *
 * @architecture
 * CRITICAL: When an error occurs for a specific request entry, the corresponding error
 * entry in the response MUST include the original, unprocessed `meta` object from that
 * request entry. This allows the client to correlate the exact input that caused the failure.
 */
export interface ErrorEntry {
  /** An optional unique identifier for this entry. */
  id?: string;
  /** The `type` of the original request entry that failed. */
  type: string;
  /** The original, unprocessed `meta` object from the request entry that failed. */
  meta?: BundleEntryMeta;
  /** The details of the error that occurred. */
  response: {
    /** The HTTP status code reflecting the error (e.g., "400", "500"). */
    status: string;
    /** A FHIR OperationOutcome resource providing detailed error diagnostics. */
    outcome: OperationOutcome;
  };
}

/**
 * Represents a single, canonical entry within a `BundleJsonApi`.
 * This structure is used for both requests and successful responses.
 *
 * @property {string} type - A string identifying the business action of the entry.
 * @property {BundleEntryMeta} meta - **(TOP-LEVEL PROPERTY)** Contains the original, unprocessed claims.
 * @property {object} resource - The primary FHIR-like resource that is the subject of the action.
 * @property {BundleRequest} [request] - Details of the requested operation (for request bundles).
 * @property {BundleResponse} [response] - Details of the operation outcome (for response bundles).
 */
export type BundleEntry = {
  id?: string;
  type: string;
  meta?: BundleEntryMeta;
  resource?: Record<string, any>;
  request?: BundleRequest;
  response?: BundleResponse;
}

// ===================================================================================
// BUNDLE DEFINITION
// ===================================================================================

/**
 * Represents the canonical Bundle structure used as the `body` of a request or response.
 * The generic type `T` allows for specifying whether the `data` array contains request
 * entries or response entries, providing strong type safety.
 *
 * @example
 * const requestBundle: BundleJsonApi<BundleEntry> = { ... };
 * const responseBundle: BundleJsonApi<BundleEntry | ErrorEntry> = { ... };
 */
export interface BundleJsonApi<T = BundleEntry | ErrorEntry> {
  data: T[];
  resourceType: 'Bundle';
  total?: number;
  type: string;
}
