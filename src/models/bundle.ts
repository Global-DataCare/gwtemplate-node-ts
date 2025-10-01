// src/models/bundle.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { OperationOutcome } from "./fhir/operation-outcome";

// ===================================================================================
// BUNDLE ENTRY COMPONENTS
// ===================================================================================

/**
 * Defines the `request` property for an entry in a request Bundle.
 */
export interface BundleRequest {
  method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  url: string;
}

/**
 * Defines the `response` property for an entry in a response Bundle.
 */
export interface BundleResponse {
  status: string; // e.g., "201"
  [key: string]: any;
}

/**
 * Defines the `meta` property that can hold contextual information.
 */
export interface BundleEntryMeta {
  claims?: Record<string, any>;
}

// ===================================================================================
// BUNDLE ENTRY TYPES
// ===================================================================================

/**
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
 * Represents a single error entry in an OUTGOING response Bundle.
 */
export interface ErrorEntry {
  id?: string;
  type: string;
  meta?: BundleEntryMeta; // Preserves original context
  response: {
    status: string;
    outcome: OperationOutcome;
  };
}

/** A union type for backward compatibility where the distinction is not yet needed. */

export type BundleEntry = BundleEntryRequest | BundleEntryResponse | ErrorEntry

// ===================================================================================
// BUNDLE DEFINITION
// ===================================================================================

/**
 * Represents the canonical Bundle structure.
 * The generic type `T` allows us to specify whether the `data` array
 * contains request entries or response entries, providing strong type safety.
 *
 * @example
 * const requestBundle: Bundle<BundleEntryRequest> = { ... };
 * const responseBundle: Bundle<BundleEntryResponse | ErrorEntry> = { ... };
 */
export interface Bundle<T = BundleEntryRequest | BundleEntryResponse | ErrorEntry> {
  type: string;
  total?: number;
  data: T[];
}
