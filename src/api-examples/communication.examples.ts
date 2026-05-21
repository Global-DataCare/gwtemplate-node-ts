// src/api-examples/communication.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

const SUBJECT_DID = 'did:web:api.acme.org:individual:123';
const DOCREF_ID = 'documentreference-from-communication-zb2rhkExampleCid001';
const DOCREF_REF = `DocumentReference/${DOCREF_ID}`;

export const COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE = {
  type: 'Communication-ingestion-request-v1.0',
  resource: {
    resourceType: 'Communication',
    status: 'completed',
    subject: { reference: `Patient/${SUBJECT_DID}` },
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
        'Communication.subject': SUBJECT_DID,
        'Communication.sent': '2026-05-16T00:00:00.000Z',
        'Communication.note': 'IPS ingestion request',
        'Communication.content-attachment-type': 'application/fhir+json',
      },
    },
  },
} as const;

export const COMMUNICATION_FHIR_REFERENCE_READ_ENTRY_EXAMPLE = {
  type: 'Communication-read-response-v1.0',
  resource: {
    resourceType: 'Communication',
    status: 'completed',
    identifier: [{ value: 'comm-2026-ips-001' }],
    subject: { reference: `Patient/${SUBJECT_DID}` },
    recipient: [{ reference: SUBJECT_DID }],
    sender: { reference: 'did:web:hospital.example.com:employee:adm-332' },
    sent: '2026-05-16T00:00:00.000Z',
    payload: [
      {
        contentReference: {
          reference: DOCREF_REF,
        },
      },
    ],
    note: [{ text: 'IPS ingestion request' }],
    meta: {
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'Communication.identifier': 'comm-2026-ips-001',
        'Communication.subject': SUBJECT_DID,
        'Communication.recipient': SUBJECT_DID,
        'Communication.sender': 'did:web:hospital.example.com:employee:adm-332',
        'Communication.sent': '2026-05-16T00:00:00.000Z',
        'Communication.note': 'IPS ingestion request',
        'Communication.content-reference': DOCREF_REF,
      },
    },
  },
} as const;

export const COMMUNICATION_CHANNEL_RECORD_EXAMPLE = {
  id: 'comm-2026-ips-001',
  type: 'CommMsgExtended',
  thid: 'thread-communication-ips-001',
  from: 'did:web:hospital.example.com:employee:adm-332',
  to: [SUBJECT_DID],
  created_time: 1778889600,
  body: {
    data: [
      {
        id: 'annotation-001',
        type: 'Annotation',
        resource: {
          text: 'IPS ingestion request',
        },
      },
      {
        id: 'reference-001',
        type: 'Reference',
        resource: {
          reference: DOCREF_REF,
          type: 'DocumentReference',
        },
      },
    ],
  },
  meta: {
    payloadCount: 1,
    documentReferenceCount: 1,
  },
  'Communication.identifier': 'comm-2026-ips-001',
  'Communication.subject': SUBJECT_DID,
  'Communication.recipient': SUBJECT_DID,
  'Communication.sender': 'did:web:hospital.example.com:employee:adm-332',
  'Communication.sent': '2026-05-16T00:00:00.000Z',
  'Communication.note': 'IPS ingestion request',
  'Communication.content-reference': DOCREF_REF,
} as const;

// Backward-compatible alias while examples migrate.
export const COMMUNICATION_INGESTION_ENTRY_EXAMPLE = COMMUNICATION_FHIR_INLINE_INGESTION_ENTRY_EXAMPLE;
