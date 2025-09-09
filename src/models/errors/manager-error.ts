// src/models/errors/manager-error.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IssueTypeCode, IssueTypeToHttpStatus } from "../fhir/codes";

/**
 * A custom error class used to propagate specific operational failures from deep
 * within the manager's logic to the central error handler.
 * It carries the necessary information to build a well-formed ErrorEntry.
 */
export class ManagerError extends Error {
  public readonly code: IssueTypeCode;
  public readonly status: string; // This is a string

  /**
   * @param message The diagnostic message for the error.
   * @param code The classification of the error, from which the HTTP status will be derived.
   */
  constructor(message: string, code: IssueTypeCode) {
    super(message);
    this.name = 'ManagerError';
    this.code = code;
    // Automatically derive the HTTP status string from the issue code.
    this.status = IssueTypeToHttpStatus[code] || '500';
  }
}
