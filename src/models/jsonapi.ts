// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/jsonapi.ts

import { RecordBase } from "./resource-document";

/**
 * Represents a resource object in a JSON:API 'included' array.
 * The type is made "open" with an index signature to allow for additional properties.
 */
export interface IncludedResource extends RecordBase {
  // 'id' is inherited from RecordBase
  type: string;
  meta: {
    claims: Record<string, any>; // The worker will create always claims (even if empty)
    [key: string]: any; // Make meta open
  };
  [key: string]: any; // Make the top-level resource open
}
