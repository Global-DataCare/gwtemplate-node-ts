// src/utils/did.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Defines the components of a DID Document Service ID for path-based validation.
 * This structure is used to programmatically build and parse service IDs.
 */
export interface DidServiceIdParts {
  version: string;
  sector: string;
  section: string;
  format: string;
}

/**
 * Creates a standardized DID Document Service ID for path-based routing and validation.
 * The format is: <version>_<sector>_<section>_<format>_path
 * Example: v1_FinancialServices_org.schema_Organization_path
 *
 * @param parts - An object containing the components of the service ID.
 * @returns A standardized string representing the service ID.
 */
export function createDidServiceId(parts: DidServiceIdParts): string {
  const { version, sector, section, format } = parts;
  // Sanitize parts to ensure they don't contain underscores, which would break parsing.
  const sanitizedParts = [version, sector, section, format].map(part => {
    if (part.includes('_')) {
      throw new Error(`Service ID part "${part}" cannot contain underscores.`);
    }
    return part;
  });

  return `${sanitizedParts.join('_')}_path`;
}
