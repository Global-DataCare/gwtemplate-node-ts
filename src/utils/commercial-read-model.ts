// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { normalizeContextualizedClaims } from './claims';

/**
 * Normalizes one portal/BFF commercial search entry into flat comparable claims.
 *
 * Current shared SDK helpers may send claims either in `entry.meta.claims` or
 * in `entry.resource.meta.claims`. GW search readers should not force frontend
 * code to care about that transport detail.
 */
export function extractCommercialSearchClaims(entry: BundleEntry): Record<string, unknown> {
  const rawClaims = entry?.meta?.claims || entry?.resource?.meta?.claims;
  return rawClaims ? normalizeContextualizedClaims(rawClaims) : {};
}

/**
 * Applies the current exact-match commercial search semantics used by hosted
 * and family offer/order read-models.
 *
 * Notes:
 * - keys starting with `@` are ignored because they describe vocab/context
 *   rather than business filters.
 * - empty expected values are ignored.
 * - pagination, date ranges, free-text ranking, and partial matching should be
 *   designed first in shared `common-utils`/BFF contracts before being baked
 *   into GW.
 */
export function matchCommercialSearch(
  claims: Record<string, unknown>,
  filters: Record<string, unknown>,
): boolean {
  return Object.entries(filters).every(([key, value]) => {
    const expected = String(value ?? '').trim();
    if (!expected || key.startsWith('@')) return true;
    return String(claims[key] ?? '').trim() === expected;
  });
}

/**
 * Projects one stored commercial artifact into the compact row shape consumed
 * by current portal-oriented read-model readers.
 */
export function buildCommercialSearchRow(
  doc: ConfidentialStorageDoc,
  claims: Record<string, unknown>,
  fallbackIdClaim: string,
): Record<string, unknown> {
  return {
    id: String(doc.id || claims[fallbackIdClaim] || '').trim() || undefined,
    meta: {
      status: doc.status,
      claims,
    },
  };
}
