// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/fhir-ingestion.ts

import { toLedgerSafeMetaTags } from '../services/ai/metaTagSanitizer';

export type SupportedFhirIngestionFormat = 'org.hl7.fhir.api' | 'org.hl7.fhir.r4';
export type ManagedFhirVersion = 'r4' | 'r5';
export type FhirVersionValidator = (resource: any, expectedResourceType: string) => void;

const fhirVersionValidators: Partial<Record<ManagedFhirVersion, FhirVersionValidator>> = {};

export function registerFhirVersionValidator(
  version: ManagedFhirVersion,
  validator: FhirVersionValidator,
): void {
  fhirVersionValidators[version] = validator;
}

export function clearFhirVersionValidators(): void {
  delete fhirVersionValidators.r4;
  delete fhirVersionValidators.r5;
}

export function normalizeFhirIngestionFormat(format: string): SupportedFhirIngestionFormat {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'org.hl7.fhir.api' || normalized === 'org.hl7.fhir.r4') {
    return normalized as SupportedFhirIngestionFormat;
  }
  throw new Error(
    `Unsupported FHIR format '${format}'. Allowed: org.hl7.fhir.api, org.hl7.fhir.r4.`,
  );
}

function resolveFhirVersion(
  format: SupportedFhirIngestionFormat,
): ManagedFhirVersion | undefined {
  if (format === 'org.hl7.fhir.r4') return 'r4';
  return undefined;
}

/**
 * Version-aware validation hook for ingestion payloads.
 * - `.api`: claims-first mode; no strict FHIR resource validation.
 * - `.r4`: validates `entry.resource.resourceType` and, if registered, invokes
 *   a concrete validator for that FHIR version.
 *
 * NOTE:
 * - R5 is not yet exposed as an ingestion format in URL routing.
 * - The validator registry is added now so R5 validators can be plugged later
 *   without changing manager logic.
 */
export function validateFhirPayloadByVersion(
  format: SupportedFhirIngestionFormat,
  expectedResourceType: string,
  entry: any,
): void {
  if (format === 'org.hl7.fhir.api') {
    return;
  }

  const resource = entry?.resource;
  if (!resource || typeof resource !== 'object') {
    throw new Error(
      `FHIR R4 validation requires entry.resource for '${expectedResourceType}'.`,
    );
  }

  const actualType = String(resource.resourceType || '').trim();
  if (!actualType) {
    throw new Error('FHIR R4 validation failed: missing resource.resourceType.');
  }
  if (actualType.toLowerCase() !== expectedResourceType.toLowerCase()) {
    throw new Error(
      `FHIR R4 validation failed: expected resourceType '${expectedResourceType}' but got '${actualType}'.`,
    );
  }

  const version = resolveFhirVersion(format);
  if (!version) return;
  const validator = fhirVersionValidators[version];
  if (validator) validator(resource, expectedResourceType);
}

/**
 * Collects ledger-safe research tags from entry-level and resource-level metadata.
 * The resulting tags are suitable for storage in `meta.tag[]` and document-level `tag[]`.
 */
export function extractLedgerSafeResearchTags(entry: any): any[] | undefined {
  const fromEntryMeta = toLedgerSafeMetaTags(entry?.meta?.tag) || [];
  const fromResourceMeta = toLedgerSafeMetaTags(entry?.resource?.meta?.tag) || [];
  const all = [...fromEntryMeta, ...fromResourceMeta];
  if (all.length === 0) return undefined;

  const unique = new Map<string, any>();
  for (const tag of all) {
    const key = `${String(tag.id)}|${String(tag.system || '')}|${String(tag.code || '')}|${String(tag.version || '')}|${String(tag.userSelected || '')}`;
    if (!unique.has(key)) unique.set(key, tag);
  }
  return Array.from(unique.values());
}
