// src/api-examples/communication.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export const COMMUNICATION_INGESTION_ENTRY_EXAMPLE = {
  type: 'Communication-ingestion-request-v1.0',
  resource: {
    resourceType: 'Communication',
    status: 'completed',
    subject: { reference: 'Patient/did:web:api.acme.org:individual:123' },
    category: [{ coding: [{ system: 'http://loinc.org', code: 'LP436847-0' }] }],
    payload: [
      {
        contentAttachment: {
          contentType: 'application/fhir+json',
          title: 'IPS Document Bundle',
          data: 'eyJyZXNvdXJjZVR5cGUiOiJCdW5kbGUiLCJ0eXBlIjoiZG9jdW1lbnQiLCJlbnRyeSI6W3sicmVzb3VyY2UiOnsicmVzb3VyY2VUeXBlIjoiQ29tcG9zaXRpb24iLCJzdGF0dXMiOiJmaW5hbCIsInR5cGUiOnsiY29kaW5nIjpbeyJzeXN0ZW0iOiJodHRwOi8vbG9pbmMub3JnIiwiY29kZSI6IjYwNTkxLTUifV19fX1dfQ==',
        },
      },
    ],
    note: [{ text: 'IPS ingestion request' }],
    meta: {
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'Communication.category': 'LOINC|LP436847-0',
        'Communication.subject': 'did:web:api.acme.org:individual:123',
        'Communication.sent': '2026-05-16T00:00:00.000Z',
        'Communication.note': 'IPS ingestion request',
        'Communication.content-attachment-type': 'application/fhir+json',
      },
    },
  },
} as const;
