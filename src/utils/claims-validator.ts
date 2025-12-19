// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/claims-validator.ts

import { ClaimsRecord } from '../models/resource-document';
import { ManagerError } from '../models/errors/manager-error';
import { IssueType } from '../models/fhir/codes';
import { ClaimsServiceSchemaorg } from '../models/schemaorg';

/**
 * Validates the claims provided for a new organization registration request.
 * This function centralizes pre-flight checks on the claims data.
 * Throws a ManagerError if the validation fails.
 *
 * @param claims The ClaimsRecord object to validate.
 * @throws {ManagerError} If any validation rule is not met.
 */
export function validateNewOrganizationClaims(claims: ClaimsRecord): void {
  console.log('--- DEBUG: Validating claims ---', JSON.stringify(claims, null, 2));
  const requestedSector = claims[ClaimsServiceSchemaorg.category];

  // Rule: A single registration entry must correspond to a single business sector.
  // To register an entity in multiple sectors, separate registration requests must be sent.
  if (typeof requestedSector === 'string' && requestedSector.includes(',')) {
    throw new ManagerError(
      'Multiple sectors (comma-separated) are not allowed in a single registration entry. Please submit one entry per sector.',
      IssueType.Value,
    );
  }

  // Future validation rules for organization claims can be added here.
}
