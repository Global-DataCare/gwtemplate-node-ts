// src/models/bundle.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { OperationOutcome } from "./fhir/operation-outcome";

/**
 * Represents the metadata associated with a BundleEntry.
 */
export interface BundleEntryMeta {
  claims?: Record<string, any>;
  [key: string]: any; // Allow other flexible meta properties
}

/**
 * Represents a single, successfully processed entry within a Bundle.
 */
export interface BundleEntry {
  id?: string;
  type: string;
  resource: Record<string, any>;
  meta?: BundleEntryMeta;
  request?: {
    method: 'POST' | 'PUT' | 'DELETE' | 'GET';
    url: string;
  };
  response: {
    status: string; // e.g., "201" for Created
    [key: string]: any;
  };
}

/**
 * Represents a single entry for an error result within a Bundle.
 * It maintains context from the original request but replaces a successful
 * resource with a FHIR-compliant OperationOutcome in the response field.
 */
export interface ErrorEntry {
  /** The 'id' might not be available if the input was malformed. */
  id?: string;

  /** The 'type' of the operation/form from the original request entry. */
  type: string;

  /** The 'resource' from the original entry might be included for context, if available. */
  resource?: Record<string, any>;

  /** The 'meta' from the original entry, which may contain the claims. */
  meta?: BundleEntryMeta;

  /** The 'request' from the original entry, if available. */
  request?: {
    method: 'POST' | 'PUT' | 'DELETE' | 'GET';
    url: string;
  };

  /** The response containing the status and a detailed FHIR OperationOutcome. */
  response: {
    status: string; // The HTTP code (e.g., "200", "201, "400", "409").
    outcome: OperationOutcome;
  };
}

/**
 * Represents the canonical Bundle structure.
 */
export interface Bundle {
  type: string;
  total?: number;
  data: (BundleEntry | ErrorEntry)[];
}
