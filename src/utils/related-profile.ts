// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
/**
 * @fileoverview Canonical `RelatedPerson` projection and indexing helpers.
 *
 * @architecture 101
 * - Keep FHIR flat-claim names centralized through shared constants.
 * - Read canonical `ClaimsContextFhirRelatedPerson` first and only then legacy aliases.
 * - Build index parameters once so write and search paths stay aligned.
 */

import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { ParameterData } from 'gdc-common-utils-ts/models/params';
import {
  ClaimsContextFhirRelatedPerson,
  FHIR_RELATED_PERSON_PATIENT_CLAIM,
  FHIR_RELATED_PERSON_STATUS_CLAIM,
  FHIR_RELATED_PERSON_TELECOM_CLAIM,
  RelatedPersonSearchParameterName,
  relatedPersonSearchParameterCatalog,
} from 'gdc-common-utils-ts/models/fhir-related-person';
import { buildIndexParametersFromSearchCatalog } from 'gdc-common-utils-ts/utils/search-parameter-catalog';
import type {
  RelatedProfileSearchInput,
  RelatedProfileSummary,
} from 'gdc-common-utils-ts/models/related-profile';
import { getClaimValue } from './claims';

const ROLE_CONTROLLER = 'controller' as const;
const ROLE_CAREGIVER = 'caregiver' as const;
const ROLE_PROFESSIONAL = 'professional' as const;
const ROLE_MEMBER = 'member' as const;
const ROLE_RELATED_PERSON = 'related-person' as const;
const ROLE_UNKNOWN = 'unknown' as const;

const STATUS_ACTIVE = 'active' as const;
const STATUS_PENDING = 'pending' as const;
const STATUS_INACTIVE = 'inactive' as const;
const STATUS_REVOKED = 'revoked' as const;
const SOURCE_RELATED_PERSON = 'relatedperson' as const;

const LEGACY_DISABLED_STATUS = 'disabled' as const;
const LEGACY_PURGED_STATUS = 'purged' as const;

/**
 * Normalizes a potentially empty text input into a trimmed optional string.
 *
 * @param value - Raw value to normalize.
 * @returns Trimmed text, or `undefined` when empty.
 */
function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

/**
 * Resolves the subject claim from canonical and compatibility aliases.
 *
 * @param claims - Flat `RelatedPerson` claims.
 * @returns Subject DID when present.
 */
export function getRelatedPersonSubjectClaimValue(claims: ClaimsRecord): string | undefined {
  return (
    normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Subject)) ||
    normalizeOptionalText(getClaimValue<string>(claims, FHIR_RELATED_PERSON_PATIENT_CLAIM))
  );
}

/**
 * Resolves the best actor-contact locator present in the claims.
 *
 * @param claims - Flat `RelatedPerson` claims.
 * @returns Preferred actor locator, preferring email over phone.
 */
export function extractRelatedProfileActorIdentifier(claims: ClaimsRecord): string | undefined {
  return (
    normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Email)) ||
    normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Phone)) ||
    normalizeOptionalText(getClaimValue<string>(claims, FHIR_RELATED_PERSON_TELECOM_CLAIM))
  );
}

/**
 * Maps free-form relationship text into a stable frontend role.
 *
 * @param relationship - Raw relationship claim.
 * @returns Stable projection role.
 */
function normalizeRelationshipRole(relationship: string | undefined): RelatedProfileSummary['role'] {
  const normalized = String(relationship || '').trim().toLowerCase();
  if (!normalized) return ROLE_UNKNOWN;
  if (normalized.includes(ROLE_CONTROLLER) || normalized.includes('resprsn')) return ROLE_CONTROLLER;
  if (normalized.includes(ROLE_CAREGIVER) || normalized.includes('guardian')) return ROLE_CAREGIVER;
  if (normalized.includes(ROLE_PROFESSIONAL)) return ROLE_PROFESSIONAL;
  if (normalized.includes(ROLE_MEMBER)) return ROLE_MEMBER;
  return ROLE_RELATED_PERSON;
}

/**
 * Maps lifecycle-like status strings into the shared projection status union.
 *
 * @param rawClaims - Flat `RelatedPerson` claims.
 * @returns Stable related-profile status.
 */
function normalizeStatus(rawClaims: ClaimsRecord): RelatedProfileSummary['status'] {
  const raw =
    normalizeOptionalText(getClaimValue<string>(rawClaims, FHIR_RELATED_PERSON_STATUS_CLAIM)) ||
    normalizeOptionalText((rawClaims as Record<string, unknown>).status);
  const normalized = String(raw || STATUS_ACTIVE).trim().toLowerCase();
  if (normalized === STATUS_PENDING) return STATUS_PENDING;
  if (normalized === STATUS_INACTIVE || normalized === LEGACY_DISABLED_STATUS) return STATUS_INACTIVE;
  if (normalized === STATUS_REVOKED || normalized === LEGACY_PURGED_STATUS) return STATUS_REVOKED;
  return STATUS_ACTIVE;
}

/**
 * Builds the index-parameter list that must travel with persisted `RelatedPerson`
 * records to support blind queries.
 *
 * @param claims - Flat `RelatedPerson` claims.
 * @returns Index parameters suitable for KMS protection and storage.
 */
export function buildRelatedPersonIndexParameters(claims: ClaimsRecord): ParameterData[] {
  return buildIndexParametersFromSearchCatalog(claims, relatedPersonSearchParameterCatalog);
}

/**
 * Picks the canonical search claim to use for an actor locator.
 *
 * @param actorIdentifier - User-facing search locator.
 * @returns Canonical claim name to query by.
 */
export function resolveRelatedPersonActorLocatorClaimName(actorIdentifier: string): string {
  const normalized = String(actorIdentifier || '').trim().toLowerCase();
  if (normalized.includes('@')) {
    return relatedPersonSearchParameterCatalog[RelatedPersonSearchParameterName.Email].name;
  }
  if (normalized.startsWith('tel:') || normalized.startsWith('+')) {
    return relatedPersonSearchParameterCatalog[RelatedPersonSearchParameterName.Phone].name;
  }
  return relatedPersonSearchParameterCatalog[RelatedPersonSearchParameterName.Phone].name;
}

/**
 * Projects raw `RelatedPerson` claims into the stable portal/BFF DTO.
 *
 * @param claims - Flat `RelatedPerson` claims.
 * @returns Stable profile summary, or `undefined` when required fields are missing.
 */
export function buildRelatedProfileSummaryFromClaims(claims: ClaimsRecord): RelatedProfileSummary | undefined {
  const subjectId = getRelatedPersonSubjectClaimValue(claims);
  const relationshipId = normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Identifier));
  if (!subjectId || !relationshipId) return undefined;

  const relationship = normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Relationship));
  const role = normalizeRelationshipRole(relationship);

  return {
    relationshipId,
    source: SOURCE_RELATED_PERSON,
    subjectId,
    actorIdentifier: extractRelatedProfileActorIdentifier(claims),
    actorDisplayName: normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Name)),
    actorTelecom:
      normalizeOptionalText(getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Phone)) ||
      normalizeOptionalText(getClaimValue<string>(claims, FHIR_RELATED_PERSON_TELECOM_CLAIM)),
    relationship,
    role,
    isController: role === ROLE_CONTROLLER,
    status: normalizeStatus(claims),
    claims: { ...claims },
  };
}

/**
 * Applies additional in-memory filters once a candidate set has already been
 * reduced through indexed lookup.
 *
 * @param summary - Candidate projection.
 * @param query - Caller search input.
 * @returns `true` when the candidate must be returned.
 */
export function matchesRelatedProfileSearch(
  summary: RelatedProfileSummary,
  query: RelatedProfileSearchInput,
): boolean {
  const actorIdentifier = String(query.actorIdentifier || '').trim().toLowerCase();
  const summaryActorIdentifier = String(summary.actorIdentifier || '').trim().toLowerCase();
  const summaryActorTelecom = String(summary.actorTelecom || '').trim().toLowerCase();
  if (!actorIdentifier) return false;
  if (summaryActorIdentifier !== actorIdentifier && summaryActorTelecom !== actorIdentifier) {
    return false;
  }
  if (query.subjectId && summary.subjectId !== String(query.subjectId).trim()) {
    return false;
  }
  if (query.relationship && summary.relationship !== String(query.relationship).trim()) {
    return false;
  }
  if (query.includeInactive !== true && summary.status !== STATUS_ACTIVE) {
    return false;
  }
  return true;
}
