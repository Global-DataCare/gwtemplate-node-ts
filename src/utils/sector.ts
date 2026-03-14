// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/sector.ts

const LEGACY_FHIR_SECTORS = new Set([
  'health-care',
  'emergency',
  'health-insurance',
  'health-tech',
  'health-it',
]);

const SYNTHETIC_FHIR_SECTOR_PATTERN = /^(animal|health)-(care|index|tech)$/;
const SYNTHETIC_RESEARCH_SECTOR_PATTERN = /^(animal|health)-research$/;

export function isFhirSector(sector: string | undefined | null): boolean {
  const normalized = String(sector || '').trim().toLowerCase();
  if (!normalized) return false;
  return LEGACY_FHIR_SECTORS.has(normalized) || SYNTHETIC_FHIR_SECTOR_PATTERN.test(normalized);
}

export function isResearchSector(sector: string | undefined | null): boolean {
  const normalized = String(sector || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'research' || SYNTHETIC_RESEARCH_SECTOR_PATTERN.test(normalized);
}
