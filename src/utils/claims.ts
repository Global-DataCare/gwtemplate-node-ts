// src/utils/claims.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4, validate as uuidValidate} from 'uuid';
import { knownDomainsReversed } from "./domains.interface";
import { findCanonicalClaimCase } from '@/models/schema-definitions';

/**
 * Normalizes a raw claims object from a client application.
 * 
 * - It takes a claims object that may have un-prefixed keys (e.g., 'email').
 * - It uses the '@context' property (e.g., 'org.schema.Person') to determine the correct prefix.
 * - It performs a case-insensitive lookup to find the canonical casing for each claim.
 * - It preserves existing, fully-qualified interoperable claims (e.g., from 'org.ilo.isco').
 * - It returns a new object with fully-qualified and correctly-cased claim keys.
 * 
 * @param {Record<string, any>} rawClaims - The claims object from the client, including '@context' and '@type'.
 * @returns {Record<string, any>} A new object with fully-qualified and correctly-cased claim keys.
 */
export function normalizeInteroperableClaims(
  rawClaims: Record<string, any>
): Record<string, any> {
  const normalizedClaims: Record<string, any> = {};
  const context = rawClaims['@context'];
  if (!context) {
    throw new Error("Claims object must have an '@context' property.");
  }

  const lowerContext = context.toLowerCase();
  const schemaKey = lowerContext;
  const prefix = `${schemaKey}.`;

  for (const key in rawClaims) {
    // Keep @context and @type as they are
    if (key === '@context' || key === '@type') {
      normalizedClaims[key] = rawClaims[key];
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isInteroperable = knownDomainsReversed.some((domain) =>
      lowerKey.startsWith(`${domain}.`)
    );

    if (isInteroperable) {
      normalizedClaims[key] = rawClaims[key];
    } else {
      const canonicalCase = findCanonicalClaimCase(schemaKey, key);
      if (canonicalCase) {
        const newKey = `${prefix}${canonicalCase}`;
        normalizedClaims[newKey] = rawClaims[key];
      } else {
        // Handle unknown claims if necessary (e.g., log a warning)
      }
    }
  }
  
  return normalizedClaims;
}

interface IncludedResource {
  type: string;
  id: string;
  meta: {
    claims: Record<string, any>;
  };
}

/**
 * Extracts the resource types from a map of claims.
 * @param claims A map of claims.
 * @returns An array of unique resource types.
 */
export function extractResourceTypes(claims: Record<string, any>): string[] {
  const resourceTypes: string[] = [];
  for (const claimName in claims) {
    if (claimName.startsWith("org.schema.")) {
      const parts = claimName.split('.');
      if (parts.length > 1) {
        const resourceType = parts[1]; // e.g., "Organization"
        if (!resourceTypes.includes(resourceType)) {
          resourceTypes.push(resourceType);
        }
      }
    }
  }
  return resourceTypes;
}

/**
 * Creates an included resource from a given type and claims.
 * @param type The resource type.
 * @param claims The claims for the resource.
 * @param environment string that can be undefined
 * @returns An included resource object.
 */
export function createIncludedResource(
  type: string,
  claims: Record<string, any>,
  environment?: string
): IncludedResource {

  let resourceId: string;
  const identifierClaim = `org.schema.${type}.identifier`;
  if (claims[identifierClaim]) {
    const identifier = claims[identifierClaim];

          if (environment !== "demo" ) {
            if (uuidValidate(identifier)) {
               resourceId = identifier;
             } else {
                throw new Error (`Invalid Identifier ${identifier}`)
             }
          } else {
             resourceId = identifier;
          }

  } else {
    resourceId = uuidv4(); // Generate a new UUID v4
  }

  return {
    type: type,
    id: resourceId, // Use the UUID v4 as the ID
    meta: {
      claims: claims
    }
  };
}