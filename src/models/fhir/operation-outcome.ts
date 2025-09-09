// src/models/fhir/operation-outcome.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IssueLevel, IssueTypeCode } from './codes';

/**
 * A single detail associated with an operation, based on a simplified FHIR structure.
 * Renamed from 'Issue' to be more neutral for potential success reporting.
 */
export interface OperationOutcomeDetails {
  /**
   * Indicates the severity of the detail.
   */
  severity: IssueLevel;

  /**
   * A code classifying the type of detail.
   */
  code: IssueTypeCode;

  /**
   * Additional diagnostic information, such as a stack trace or detailed error message.
   */
  diagnostics?: string;
}

/**
 * A structured response detailing the result of an operation, based on a simplified FHIR structure.
 */
export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeDetails[];
}
