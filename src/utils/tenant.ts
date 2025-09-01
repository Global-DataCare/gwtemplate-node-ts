// src/utils/tenant.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Validates a tenant's alternateName to ensure it doesn't conflict with the "host" name.
 * @param alternateName The alternateName to validate.
 * @returns True if the alternateName is valid, false otherwise.
 */
export function isValidTenantAlternateName(alternateName: string): boolean {
  if (!alternateName) {
    return false; // Or throw an error, depending on your requirements
  }
  const lowerName = alternateName.toLowerCase();
  if (lowerName === "host" || lowerName.startsWith("host") || lowerName.endsWith("host")) {
    return false; // Invalid name
  }
  return true; // Valid name
}