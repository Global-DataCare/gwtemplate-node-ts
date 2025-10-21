// src/utils/tenant.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ClaimsOrganizationSchemaorg } from '../models/schemaorg';

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
 * Validates a tenant's alternateName to ensure it doesn't conflict with reserved patterns.
 * @param alternateName The alternateName to validate.
 * @returns True if the alternateName is valid, false otherwise.
 */
export function isValidTenantAlternateName(alternateName: string): boolean {
  if (!alternateName) {
    return false;
  }
  // Underscore is a reserved character for the vaultId separator.
  if (alternateName.includes('_')) {
    return false;
  }
  const lowerName = alternateName.toLowerCase();
  if (lowerName === "host" || lowerName.startsWith("host") || lowerName.endsWith("host")) {
    return false;
  }
  return true;
}

/**
 * Extracts the canonical identifier URN from a claims object.
 * @param claims The claims object from an entity configuration.
 * @returns The URN string, or undefined if not found.
 */
export function getIdentifierUrnFromClaims(claims: any): string | undefined {
  if (!claims) {
    return undefined;
  }
  return claims[ClaimsOrganizationSchemaorg.identifier] as string;
}


/**
 * Parses a DID (`did:web`) of a hosted entity (Employee, Individual) to extract 
 * the components needed to form the parent tenant's vault ID.
 * Example: `did:web:provider.com:acme:cds-es:v1:health-care:employee:admin` -> `health-care_acme`
 *
 * @param iss The issuer DID string.
 * @returns The composite vault ID string.
 * @throws An error if the DID format is not a supported hosted DID format.
 */
export function getTenantVaultIdFromIss(iss: string): string {
  const parts = iss.split(':');
  // Minimum parts for a hosted DID: did:web:domain:tenant:cds-xx:v1:sector...
  if (parts.length < 7 || parts[0] !== 'did' || parts[1] !== 'web') {
    throw new Error(`Invalid or unsupported DID format for issuer: ${iss}`);
  }
  
  const tenantId = parts[3];
  const sector = parts[6];
  
  if (!sector || !tenantId) {
    throw new Error(`Could not extract sector and tenantId from DID: ${iss}`);
  }
  
  return getTenantVaultId(sector, tenantId);
}