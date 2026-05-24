// src/api-examples/communication.examples.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { CommunicationCategoryCodes, HealthcareBasicSections } from '../shared/healthcare-constants';

const IPS_BUNDLE_LIGHT_EXAMPLE = {
  resourceType: 'Bundle',
  type: 'document',
  entry: [
    {
      resource: {
        resourceType: 'Composition',
        status: 'final',
        type: {
          coding: [{
            system: HealthcareBasicSections.PatientSummaryDocument.system,
            code: HealthcareBasicSections.PatientSummaryDocument.code,
          }],
        },
      },
    },
  ],
} as const;

const IPS_DOCUMENT_REFERENCE_EXAMPLE = {
  resourceType: 'DocumentReference',
  subject: { reference: 'did:web:api.acme.org:individual:123' },
  date: '2026-05-16T00:00:00.000Z',
  description: 'IPS Document Bundle',
  identifier: [{ value: 'urn:uuid:ips-document-reference-001' }],
  content: [
    {
      attachment: {
        contentType: 'application/fhir+json',
        title: 'ips-light.json',
        data: Buffer.from(JSON.stringify(IPS_BUNDLE_LIGHT_EXAMPLE), 'utf8').toString('base64'),
      },
    },
  ],
} as const;

export const COMMUNICATION_INGESTION_ENTRY_EXAMPLE = {
  type: 'Communication-ingestion-request-v1.0',
  resource: {
    resourceType: 'Communication',
    status: 'completed',
    subject: { reference: 'Patient/did:web:api.acme.org:individual:123' },
    category: [{
      coding: [{
        system: CommunicationCategoryCodes.Notification.system,
        code: CommunicationCategoryCodes.Notification.code,
      }],
    }],
    payload: [
      {
        contentAttachment: {
          contentType: 'application/fhir+json',
          title: 'IPS DocumentReference',
          data: Buffer.from(JSON.stringify(IPS_DOCUMENT_REFERENCE_EXAMPLE), 'utf8').toString('base64'),
        },
      },
    ],
    note: [{ text: 'IPS ingestion request' }],
    meta: {
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'Communication.category': CommunicationCategoryCodes.Notification.claim,
        'Communication.subject': 'did:web:api.acme.org:individual:123',
        'Communication.sent': '2026-05-16T00:00:00.000Z',
        'Communication.note-text': 'IPS ingestion request',
        'Communication.content-attachment-type': 'application/fhir+json',
      },
    },
  },
} as const;

export const COMMUNICATION_INGESTION_MESSAGE_EXAMPLE = {
  jti: 'unique-communication-message-ips-001',
  thid: 'thread-communication-ips-001',
  iss: 'did:web:ehr-system.example.com',
  aud: 'did:web:gateway.acme.org',
  type: 'application/fhir+json; fhirVersion=4.0',
  body: {
    resourceType: 'Bundle',
    type: 'batch',
    entry: [
      {
        request: {
          method: 'POST',
          url: 'individual/org.hl7.fhir.r4/Communication',
        },
        ...COMMUNICATION_INGESTION_ENTRY_EXAMPLE,
      },
    ],
  },
} as const;
