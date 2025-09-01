// src/models/manager-result.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * The format-agnostic result of a manager's processing operation.
 * The worker is responsible for formatting this into a final response Bundle.
 */
export interface ManagerResult {
  successEntries: { id: string; status: string; resource?: any }[];
  errorEntries: { id: string; status: string; errorMessage: string }[];
}
