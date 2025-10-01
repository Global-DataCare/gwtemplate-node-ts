// src/utils/did.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Extracts the percent-encoded hostname from the configured public API URL.
 * @param apiBaseUrl The full base URL of the API (e.g., "http://localhost:3000").
 * @returns The hostname part (e.g., "localhost%3A3000" or "api.example.com").
 */
function getEncodedHost(apiBaseUrl: string): string {
  try {
    const parsedUrl = new URL(apiBaseUrl);
    const host = parsedUrl.host; // e.g., localhost:3000
    // Per the did:web spec, a port number's colon MUST be percent-encoded.
    return host.replace(':', '%3A');
  } catch (e) {
    console.error(`[getEncodedHost] Invalid apiBaseUrl provided: ${apiBaseUrl}`);
    return 'localhost'; // Fallback for safety
  }
}

/**
 * Constructs the web DID for the root host service.
 * @param apiBaseUrl The full base URL of the API.
 * @returns The host's DID string (e.g., "did:web:localhost%3A3000").
 */
export function getHostDidWebId(apiBaseUrl: string): string {
  const encodedHost = getEncodedHost(apiBaseUrl);
  return `did:web:${encodedHost}`;
}

/**
 * Constructs the web DID for a specific tenant.
 * @param tenantId The alternateName of the tenant.
 * @param apiBaseUrl The full base URL of the API.
 * @returns The tenant's DID string (e.g., "did:web:localhost%3A3000:tenant1").
 */
export function getTenantDidWebId(tenantId: string, apiBaseUrl: string): string {
  const encodedHost = getEncodedHost(apiBaseUrl);
  // Tenant-specific DIDs are created as sub-paths from the main host DID.
  return `did:web:${encodedHost}:${tenantId}`;
}

/**
 * Creates a standardized, case-insensitive DID Document Service ID for path-based routing and validation.
 * The format is: <version>_<sector>_<section>_<format>
 * Example: v1_test_registry_org-schema
 *
 * @param parts - An object containing the components of the service ID.
 * @returns A standardized, lowercase string representing the service ID.
 */
export const createDidServiceId = (params: {
  version: string,
  sector: string,
  section: string,
  format: string,
}) => {
  // Sanitize all parts to be lowercase for case-insensitive matching.
  const version = params.version.toLowerCase();
  const sector = params.sector.toLowerCase();
  const section = params.section.toLowerCase();
  // Replace dots with hyphens in format for consistency in IDs.
  const sanitizedFormat = params.format.toLowerCase().replace(/\./g, '-');
  return `${version}_${sector}_${section}_${sanitizedFormat}`;
};
