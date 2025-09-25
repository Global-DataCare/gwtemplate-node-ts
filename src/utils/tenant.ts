// src/utils/tenant.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

  /**
 * Constructs the unique vault identifier for a tenant from its sector and alternate name.
 * This composite ID is used as the vault name in the repository and as the `entityId`
 * for the tenant's keys in the Key Management Service.
 *
 * @param sector The business sector of the tenant (e.g., 'health', 'insurance').
 * @param alternateName The unique alternate name of the tenant (e.g., 'acme-health-us').
 * @returns A composite string in the format `sector_alternateName`.
 */
export function getTenantVaultId(sector: string, alternateName: string): string {
  if (!sector || !alternateName) {
    throw new Error('Both sector and alternateName are required to create a tenant vault ID.');
  }
  return `${sector}_${alternateName}`;
}


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