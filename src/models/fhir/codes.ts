// src/models/fhir/codes.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Source: https://www.hl7.org/fhir/valueset-issue-severity.html

/**
 * Defines the level of an issue.
 */
export enum IssueLevel {
  /** The issue is fatal and the system is in an unstable state. */
  Fatal = 'fatal',
  /** The issue is an error that prevents the action from completing. */
  Error = 'error',
  /** The issue is a warning that does not prevent the action from completing. */
  Warning = 'warning',
  /** The issue is informational and requires no action. */
  Information = 'information',
}

// Source: https://www.hl7.org/fhir/valueset-issue-type.html
/**
 * Defines the code for the type of issue.
 * This is a subset of the full FHIR value set, focused on common API scenarios.
 */
export const IssueType = {
  // --- Category: Invalid Content ---
  /** Content invalid against the specification. */
  Invalid: 'invalid',
  /** A required element is missing. */
  Required: 'required',
  /** An element value is invalid. */
  Value: 'value',
  /** A business rule has been violated. */
  BusinessRule: 'business-rule',

  // --- Category: Security ---
  /** An authentication/authorization error has occurred. */
  Login: 'login',
  /** The user is not authorized for the requested action. */
  Forbidden: 'forbidden',
  /** A security-related issue has been detected. */
  Security: 'security',

  // --- Category: Processing ---
  /** The resource was not found. */
  NotFound: 'not-found',
  /** The operation led to a conflict. */
  Conflict: 'conflict',
  /** A duplicate record was detected. */
  Duplicate: 'duplicate',
  /** The operation is not supported. */
  NotSupported: 'not-supported',
  /** An internal processing exception occurred. */
  Exception: 'exception',
  /** The operation has timed out. */
  Timeout: 'timeout',
  /** The operation was throttled. */
  Throttled: 'throttled',
} as const;

/**
 * A union type derived from the keys of the IssueType object.
 * This ensures that only defined issue type codes can be used.
 */
export type IssueTypeCode = typeof IssueType[keyof typeof IssueType];

/**
 * Maps our internal IssueType codes to the appropriate HTTP status code strings.
 * This provides a single source of truth for error responses.
 */
export const IssueTypeToHttpStatus: Record<IssueTypeCode, string> = {
  [IssueType.Invalid]: '400',
  [IssueType.Required]: '400',
  [IssueType.Value]: '400',
  [IssueType.BusinessRule]: '400',
  [IssueType.Login]: '401',
  [IssueType.Forbidden]: '403',
  [IssueType.Security]: '403',
  [IssueType.NotFound]: '404',
  [IssueType.Conflict]: '409',
  [IssueType.Duplicate]: '409',
  [IssueType.NotSupported]: '501',
  [IssueType.Exception]: '500',
  [IssueType.Timeout]: '503',
  [IssueType.Throttled]: '429',
};
