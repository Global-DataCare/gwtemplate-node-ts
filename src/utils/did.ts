// src/utils/did.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { config } from '../config';

/**
 * Extracts the percent-encoded hostname from the configured public API URL.
 * @returns The hostname part (e.g., "localhost%3A3000" or "api.example.com").
 */
function getEncodedHost(): string {
  try {
    const parsedUrl = new URL(config.apiBaseUrl);
    const host = parsedUrl.host; // e.g., localhost:3000
    // Per the did:web spec, a port number's colon MUST be percent-encoded.
    return host.replace(':', '%3A');
  } catch (e) {
    return 'localhost';
  }
}

/**
 * Constructs the web DID for the root host service.
 * @returns The host's DID string (e.g., "did:web:localhost%3A3000").
 */
export function getHostDidWebId(): string {
  const encodedHost = getEncodedHost();
  return `did:web:${encodedHost}`;
}

/**
 * Constructs the web DID for a specific tenant.
 * @param tenantId The alternateName of the tenant.
 * @returns The tenant's DID string (e.g., "did:web:localhost%3A3000:tenant1").
 */
export function getTenantDidWebId(tenantId: string): string {
  const encodedHost = getEncodedHost();
  // Tenant-specific DIDs are created as sub-paths from the main host DID.
  return `did:web:${encodedHost}:${tenantId}`;
}


/**
 * Creates a standardized DID Document Service ID for path-based routing and validation.
 * The format is: <version>_<sector>_<section>_<format>_path
 * Example: v1_test_org.schema_Organization_path
 *
 * @param parts - An object containing the components of the service ID.
 * @returns A standardized string representing the service ID.
 */
export const createDidServiceId = (params: {
  version: string,
  sector: string,
  section: string,
  format: string,
}) => {
  // Replace dots with hyphens in format for consistency in IDs.
  const sanitizedFormat = params.format.replace(/\./g, '-');
  return `${params.version}_${params.sector}_${params.section}_${sanitizedFormat}`;
};
