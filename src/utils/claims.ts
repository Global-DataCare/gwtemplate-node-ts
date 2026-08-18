// src/utils/claims.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4, validate as uuidValidate} from 'uuid';
import { knownDomainsReversed } from "gdc-common-utils-ts/models/urlPath";
import { normalizeFhirApiClaimKey } from 'gdc-common-utils-ts/utils/fhir-api-claim-helpers';
import { findCanonicalClaimCase } from '../gdc-backend-utils-node/models/schema-definitions';

/**
 * Defines the constant for the response modes property ID.
 */
const RESPONSE_MODES_PROPERTY_ID = 'net.openid.connect.discovery.response_modes_supported';

/**
 * Defines the allowlist of supported response modes.
 */
const SUPPORTED_RESPONSE_MODES = ['form_post.jwt', 'json', 'fhir+json'];

/**
 * Defines the default, required response mode.
 */
const DEFAULT_RESPONSE_MODE = 'form_post.jwt';

/**
 * Processes the flat claim string for `response_modes_supported` to enforce business rules.
 *
 * @param claim - The raw claim string from the request (e.g., "propertyId|value1,value2").
 * @returns A canonical, validated claim string that adheres to system rules.
 */
export const processResponseModesClaim = (claim: string | undefined): string => {
  // Rule: Handle malformed or missing claims by returning the default.
  if (!claim || !claim.trim().includes('|')) {
    return `${RESPONSE_MODES_PROPERTY_ID}|${DEFAULT_RESPONSE_MODE}`;
  }

  const parts = claim.trim().split('|');
  const propertyId = parts[0].trim();
  const claimValues = parts[1];

  // Rule: Handle empty value lists by returning the default.
  if (!claimValues) {
    return `${RESPONSE_MODES_PROPERTY_ID}|${DEFAULT_RESPONSE_MODE}`;
  }

  // 1. Parse, trim whitespace from each mode, and remove any empty values.
  let modes = claimValues.split(',').map(mode => mode.trim()).filter(Boolean);

  // 2. Filter the list against the allowlist of supported modes.
  modes = modes.filter(mode => SUPPORTED_RESPONSE_MODES.includes(mode));

  // 3. Ensure the default mode is always present using a Set to handle duplicates.
  const modeSet = new Set(modes);
  modeSet.add(DEFAULT_RESPONSE_MODE);

  // 4. Convert back to an array and sort based on the canonical order in SUPPORTED_RESPONSE_MODES.
  const finalModes = Array.from(modeSet);
  finalModes.sort((a, b) => {
    return SUPPORTED_RESPONSE_MODES.indexOf(a) - SUPPORTED_RESPONSE_MODES.indexOf(b);
  });

  // 5. Re-assemble the final, canonical claim string.
  return `${propertyId}|${finalModes.join(',')}`;
};

export function sortClaimsAlphabetically<T extends Record<string, any>>(claims: T): T {
  const sortedKeys = Object.keys(claims).sort((a, b) => a.localeCompare(b));
  const sorted: Record<string, any> = {};
  for (const key of sortedKeys) sorted[key] = claims[key];
  return sorted as T;
}

export function getClaimValue<T = any>(claims: Record<string, any>, key: string): T | undefined {
  if (claims[key] !== undefined) return claims[key] as T;

  const context = claims['@context'];
  if (typeof context === 'string' && context.length > 0) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    // Identity claims may be stored either contextualized (`org.schema.Order...`)
    // or canonical (`Order...`). Callers use the exported fully-qualified claim
    // constants, so lookup must work in both configured storage modes.
    if (key.startsWith(prefix)) {
      const canonicalKey = key.slice(prefix.length);
      if (claims[canonicalKey] !== undefined) return claims[canonicalKey] as T;
    } else {
      const prefixedKey = `${prefix}${key}`;
      if (claims[prefixedKey] !== undefined) return claims[prefixedKey] as T;
    }
  }

  return undefined;
}

const DEFAULT_FHIR_CLAIM_CONTEXTS = Object.freeze([
  'org.hl7.fhir.api',
  'org.hl7.fhir.r4',
  'org.hl7.fhir.r5',
] as const);

const CANONICAL_SCHEMA_ORG_CLAIM = /^[A-Z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;

type ClaimVocabularyValidation = {
  vocabulary: 'FHIR API' | 'Schema.org';
  valid: boolean;
  reason?: string;
};

function validateClaimKeyForContext(claimKey: string, context: string): ClaimVocabularyValidation | undefined {
  const key = String(claimKey || '').trim();
  const normalizedContext = String(context || '').trim();
  const lowerContext = normalizedContext.toLowerCase();
  const isExplicitFhir = /^(?:org\.hl7\.fhir\.(?:api|r4|r5)|api)\./.test(key);
  const isExplicitSchema = key.startsWith('org.schema.');
  if (isExplicitFhir) {
    const shortKey = stripKnownFhirClaimContextPrefix(key);
    let valid = true;
    try {
      normalizeFhirApiClaimKey(shortKey);
    } catch {
      valid = false;
    }
    return {
      vocabulary: 'FHIR API',
      valid,
      ...(!valid ? { reason: 'expected <ResourceType>.<lower-kebab-case-search-param>' } : {}),
    };
  }

  if (isExplicitSchema) {
    const shortKey = key.slice('org.schema.'.length);
    const valid = CANONICAL_SCHEMA_ORG_CLAIM.test(shortKey);
    return {
      vocabulary: 'Schema.org',
      valid,
      ...(!valid ? { reason: 'expected <Type>.<camelCase-property-path> without hyphens or underscores' } : {}),
    };
  }

  const isForeignInteroperable = knownDomainsReversed.some((domain) =>
    key.toLowerCase().startsWith(`${domain}.`),
  );
  if (isForeignInteroperable) return undefined;

  if (lowerContext === 'api' || lowerContext.startsWith('org.hl7.fhir')) {
    const shortKey = stripKnownFhirClaimContextPrefix(key);
    let valid = true;
    try {
      normalizeFhirApiClaimKey(shortKey);
    } catch {
      valid = false;
    }
    return {
      vocabulary: 'FHIR API',
      valid,
      ...(!valid ? { reason: 'expected <ResourceType>.<lower-kebab-case-search-param>' } : {}),
    };
  }

  if (lowerContext.startsWith('org.schema')) {
    let shortKey = key;
    if (!isExplicitSchema && !/^[A-Z][A-Za-z0-9]*\./.test(shortKey)) {
      const contextType = normalizedContext.slice('org.schema.'.length);
      if (contextType) shortKey = `${contextType}.${shortKey}`;
    }
    const valid = CANONICAL_SCHEMA_ORG_CLAIM.test(shortKey);
    return {
      vocabulary: 'Schema.org',
      valid,
      ...(!valid ? { reason: 'expected <Type>.<camelCase-property-path> without hyphens or underscores' } : {}),
    };
  }

  return undefined;
}

function omitMalformedContextClaims(rawClaims: Record<string, any>, context: string): Record<string, any> {
  const validClaims: Record<string, any> = {};
  for (const [claimKey, value] of Object.entries(rawClaims || {})) {
    if (claimKey === '@context' || claimKey === '@type') {
      validClaims[claimKey] = value;
      continue;
    }
    const validation = validateClaimKeyForContext(claimKey, context);
    if (validation && !validation.valid) {
      console.warn('[claims] omitted malformed claim', {
        context,
        claimKey,
        vocabulary: validation.vocabulary,
        reason: validation.reason,
      });
      continue;
    }
    validClaims[claimKey] = value;
  }
  return validClaims;
}

export function getSupportedFhirClaimContexts(): string[] {
  const configured = String(process.env.CLAIMS_FHIR_CONTEXT_PREFIXES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...(configured.length > 0 ? configured : []), ...DEFAULT_FHIR_CLAIM_CONTEXTS]));
}

export function stripKnownFhirClaimContextPrefix(key: string): string {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) return trimmedKey;

  for (const context of getSupportedFhirClaimContexts()) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    if (trimmedKey.startsWith(prefix)) return trimmedKey.slice(prefix.length);
  }

  if (trimmedKey.startsWith('api.')) return trimmedKey.slice('api.'.length);
  return trimmedKey;
}

export function canonicalizeFhirClaims(rawClaims: Record<string, any>, targetContext = 'org.hl7.fhir.api'): Record<string, any> {
  const canonicalClaims: Record<string, any> = {
    '@context': targetContext,
  };

  const entries = Object.entries(rawClaims || {});
  const canonicalKeyFor = (key: string): string => stripKnownFhirClaimContextPrefix(key)
    .replace(/\.CodeDisplay$/, '.code-display')
    .replace(/\.CodeTextLocal$/, '.code-text');

  // Compatibility aliases are applied first. A canonical key always wins
  // independently of the insertion order of the persisted record.
  for (const [key, value] of entries) {
    if (!/\.(?:CodeDisplay|CodeTextLocal)$/.test(stripKnownFhirClaimContextPrefix(key))) continue;
    canonicalClaims[canonicalKeyFor(key)] = value;
  }

  for (const [key, value] of entries) {
    if (key === '@type') {
      canonicalClaims[key] = value;
      continue;
    }
    if (key === '@context') continue;
    const shortKey = stripKnownFhirClaimContextPrefix(key);
    if (/\.(?:CodeDisplay|CodeTextLocal)$/.test(shortKey)) continue;
    const isFhirClaim = /^(?:org\.hl7\.fhir\.(?:api|r4|r5)|api)\./.test(key)
      || /^[A-Z][A-Za-z0-9]+\./.test(shortKey);
    if (isFhirClaim) {
      const validation = validateClaimKeyForContext(key, targetContext);
      if (validation && !validation.valid) {
        console.warn('[claims] omitted malformed claim', {
          context: targetContext,
          claimKey: key,
          vocabulary: validation.vocabulary,
          reason: validation.reason,
        });
        continue;
      }
    }
    canonicalClaims[canonicalKeyFor(key)] = value;
  }

  return sortClaimsAlphabetically(canonicalClaims);
}

export function buildContextualClaimKeys(baseKey: string, contexts: string[]): string[] {
  const canonicalKey = String(baseKey || '').trim();
  if (!canonicalKey) return [];
  return Array.from(new Set([
    canonicalKey,
    ...contexts.map((context) => `${context}.${canonicalKey}`),
  ]));
}

export function buildFhirClaimKeys(baseKey: string): string[] {
  return buildContextualClaimKeys(stripKnownFhirClaimContextPrefix(baseKey), getSupportedFhirClaimContexts());
}

export function getFirstClaimValueByKeys<T = any>(claims: Record<string, any>, keys: string[]): T | undefined {
  for (const key of keys) {
    const value = getClaimValue<T>(claims, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Normalizes a claims object where `@context` defines the namespace prefix (e.g., `org.schema`)
 * and clients may send "contextualized" keys without that prefix (e.g., `Offer.identifier`).
 *
 * Normalization rules:
 * - Keep `@context`/`@type` and interoperable fully-qualified claims as-is.
 * - For any other key that doesn't start with the context prefix, prepend `${@context}.`.
 * - Return a new object with keys sorted alphabetically (stable canonicalization).
 */
export function normalizeContextualizedClaims(rawClaims: Record<string, any>): Record<string, any> {
  const context = rawClaims?.['@context'];
  if (typeof context !== 'string' || context.trim().length === 0) {
    return sortClaimsAlphabetically({ ...(rawClaims || {}) });
  }

  const trimmedContext = context.trim();
  const claimsToNormalize = omitMalformedContextClaims(rawClaims, trimmedContext);
  const prefix = trimmedContext.endsWith('.') ? trimmedContext : `${trimmedContext}.`;
  const storageMode = resolveClaimsStorageMode(trimmedContext);
  if (storageMode === 'canonical') {
    const canonicalized: Record<string, any> = {};
    for (const key of Object.keys(claimsToNormalize)) {
      if (key === '@context' || key === '@type') {
        canonicalized[key] = claimsToNormalize[key];
        continue;
      }
      canonicalized[stripContextualPrefix(key, trimmedContext)] = claimsToNormalize[key];
    }
    return sortClaimsAlphabetically(canonicalized);
  }

  const normalized: Record<string, any> = {};
  for (const key of Object.keys(claimsToNormalize)) {
    if (key === '@context' || key === '@type') {
      normalized[key] = claimsToNormalize[key];
      continue;
    }

    const lowerKey = key.toLowerCase();
    const isInteroperable = knownDomainsReversed.some((domain) => lowerKey.startsWith(`${domain}.`));
    if (isInteroperable || key.startsWith(prefix)) {
      normalized[key] = claimsToNormalize[key];
      continue;
    }

    const normalizedKey = `${prefix}${key}`;
    if (normalized[normalizedKey] === undefined) {
      normalized[normalizedKey] = claimsToNormalize[key];
    }
  }

  return sortClaimsAlphabetically(normalized);
}

type ClaimsStorageMode = 'contextualized' | 'canonical';

function resolveClaimsStorageMode(context: string): ClaimsStorageMode {
  const normalizedContext = String(context || '').trim().toLowerCase();
  const isFhir = normalizedContext === 'api' || normalizedContext.startsWith('org.hl7.fhir');
  const isIdentity = normalizedContext.startsWith('org.schema');
  if (isFhir) {
    return normalizeMode(process.env.CLAIMS_FHIR_STORAGE_MODE) || 'contextualized';
  }
  if (isIdentity) {
    return normalizeMode(process.env.CLAIMS_IDENTITY_STORAGE_MODE) || 'contextualized';
  }
  return normalizeMode(process.env.CLAIMS_DEFAULT_STORAGE_MODE) || 'contextualized';
}

function normalizeMode(raw: unknown): ClaimsStorageMode | undefined {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'contextualized' || mode === 'canonical') return mode;
  return undefined;
}

function stripContextualPrefix(key: string, context: string): string {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) return trimmedKey;
  const contextPrefix = context.endsWith('.') ? context : `${context}.`;
  if (trimmedKey.startsWith(contextPrefix)) return trimmedKey.slice(contextPrefix.length);

  const normalizedContext = String(context || '').trim().toLowerCase();
  if (normalizedContext === 'api' || normalizedContext.startsWith('org.hl7.fhir')) {
    return stripKnownFhirClaimContextPrefix(trimmedKey);
  }
  if (normalizedContext.startsWith('org.schema') && trimmedKey.startsWith('org.schema.')) {
    return trimmedKey.slice('org.schema.'.length);
  }
  return trimmedKey;
}


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
