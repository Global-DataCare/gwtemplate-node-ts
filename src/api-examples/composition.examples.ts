// src/api-examples/composition.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export const COMPOSITION_BATCH_ENTRY_EXAMPLE = {
  type: 'Composition',
  meta: {
    claims: {
      '@context': 'org.hl7.fhir.api',
      'Composition.subject': 'did:web:connector.example.com:animal:chip:z123',
      'Composition.section': 'LOINC|26436-6',
      'Composition.author': 'did:web:clinic.example.com:employee:loader',
      'Composition.date': '2026-03-03T10:00:00Z',
      'Composition.entry': 'urn:uuid:docref-a,urn:uuid:docref-b',
      'Composition.type': 'LOINC|60591-5',
    },
  },
} as const;

export const COMPOSITION_SEARCH_BUNDLE_EXAMPLE = {
  resourceType: 'Bundle',
  type: 'batch',
  entry: [
    {
      request: {
        method: 'GET',
        url: 'Composition?subject=did:web:connector.example.com:animal:chip:z123',
      },
    },
  ],
} as const;

export const COMPOSITION_SEARCH_PARAMETERS_EXAMPLE = {
  resourceType: 'Parameters',
  parameter: [
    {
      name: 'subject',
      valueString: 'did:web:connector.example.com:animal:chip:z123',
    },
  ],
} as const;

