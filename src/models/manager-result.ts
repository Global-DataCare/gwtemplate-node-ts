// src/models/manager-result.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { BundleEntry } from '@/models/bundle';

/**
 * The format-agnostic result of a manager's processing operation.
 * It contains a single, ordered list of entries representing the outcome of
 * each operation in the batch. The order of entries MUST be preserved.
 * The worker is responsible for formatting this into a final response Bundle.
 */
export interface ManagerResult {
  entries: BundleEntry[];
}
