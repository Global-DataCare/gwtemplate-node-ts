// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/CommunicationManager.unit.test.ts
// Description: Unit tests for the CommunicationManager.

import { jest } from '@jest/globals';
import { CommunicationManager } from '../../../managers/CommunicationManager';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { testCommunicationAppointmentFhirR4, testCommMsgExtAppointmentRequest, testAppointmentRequestText } from '../../data/appointment.data';
import { DataEntry } from 'gdc-common-utils-ts/models/comm';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { randomUUID } from 'crypto';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IJobProcessor } from '../../../managers/registry';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from '../../../shared/healthcare-constants';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { getClaimValue } from '../../../utils/claims';
import { knownDomainsReversedEnum } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_CONSENT_DATE,
  EXAMPLE_EMAIL_PROFESSIONAL,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SECONDARY_EU_COUNTRY,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';

const ODRL_MEDIA_TYPE = 'application/odrl+json';
const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';

function buildIdentifierUuidForTesting(
  resourceType: 'consent',
  qualifier: 'professional' | 'organization' | 'jurisdictions',
  sequence: number,
): string {
  return `urn:uuid:${resourceType}-${qualifier}-${String(sequence).padStart(3, '0')}`;
}

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockCompositionManager: jest.Mocked<IJobProcessor>;
  let mockIndividualManager: jest.Mocked<IJobProcessor>;
  const testServerDid = 'did:web:test-server.com';

  beforeEach(() => {
    // Create a new mock instance for each test
    mockTenantsCacheManager = {
      getTenantDid: jest.fn(),
    } as unknown as jest.Mocked<TenantsCacheManager>;
    mockVaultRepository = {
      vaultExists: jest.fn(async () => false),
      put: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<IVaultRepository>;
    mockCompositionManager = {
      process: jest.fn(),
    } as unknown as jest.Mocked<IJobProcessor>;
    mockIndividualManager = {
      process: jest.fn(),
    } as unknown as jest.Mocked<IJobProcessor>;
    
    communicationManager = new CommunicationManager({
      tenantsCacheManager: mockTenantsCacheManager,
      vaultRepository: mockVaultRepository,
      compositionManager: mockCompositionManager,
      individualManager: mockIndividualManager,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('convertFhirToCommMsg', () => {
    it('should correctly convert a FHIR Communication resource to a CommMsgExtended object', () => {
      const fhirResource = { ...testCommunicationAppointmentFhirR4, resourceType: 'Communication' as const };
      const expectedCommMsg = testCommMsgExtAppointmentRequest;
      const testThid = expectedCommMsg.thid;
      
      const result = communicationManager.convertFhirToCommMsg(testThid, testServerDid, fhirResource);

      // --- Assertions for DIDComm properties ---
      expect(result.thid).toEqual(testThid);
      expect(result.to).toEqual(expectedCommMsg.to);
      // The 'from' field should now be the server DID, not the one from the FHIR resource
      expect(result.from).toEqual(testServerDid);
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
      expect(result.created_time).toBeCloseTo(expectedCommMsg.nbf);

      // --- Assertions for body payload ---
      expect(result.body.data).toHaveLength(2);
      expect(result.body.data.some((item: DataEntry) => item.type === 'Annotation')).toBe(false);

      // 1. Verify Reference
      const referenceItem = result.body.data.find((item: DataEntry) => item.type === 'Reference');
      const expectedReference = expectedCommMsg.body.data.find((item: any) => item.type === 'Reference');
      expect(referenceItem).toBeDefined();
      expect(expectedReference).toBeDefined();
      if (referenceItem && expectedReference && expectedReference.resource) {
        expect(referenceItem.resource.reference).toEqual(expectedReference.resource.reference);
        expect(referenceItem.meta?.claims?.['Communication.note-text']).toEqual(testAppointmentRequestText);
        expect(typeof referenceItem.id).toBe('string');
      }

      // 2. Verify Attachment
      const attachmentItem = result.body.data.find((item: DataEntry) => item.type === 'Attachment');
      const expectedAttachment = expectedCommMsg.body.data.find((item: any) => item.type === 'Attachment');
      expect(attachmentItem).toBeDefined();
      expect(expectedAttachment).toBeDefined();
      if (attachmentItem && expectedAttachment && expectedAttachment.resource) {
        expect(attachmentItem.resource.contentType).toEqual(expectedAttachment.resource.contentType);
        expect(attachmentItem.resource.data).toEqual(expectedAttachment.resource.data);
        expect(attachmentItem.resource.title).toEqual(expectedAttachment.resource.title);
        expect(attachmentItem.meta?.claims?.['Communication.note-text']).toEqual(testAppointmentRequestText);
        expect(typeof attachmentItem.id).toBe('string');
      }
    });

    it('distributes note texts across payload entries when counts match', () => {
      const fhirResource = {
        resourceType: 'Communication' as const,
        status: 'completed',
        payload: [
          { contentReference: { reference: 'https://example.org/ref-1' } },
          { contentReference: { reference: 'https://example.org/ref-2' } },
        ],
        note: [
          { text: 'first note' },
          { text: 'second note' },
        ],
      };

      const result = communicationManager.convertFhirToCommMsg('thread-notes-001', testServerDid, fhirResource as any);

      expect(result.body.data).toHaveLength(2);
      expect(result.body.data[0].meta?.claims?.['Communication.note-text']).toBe('first note');
      expect(result.body.data[1].meta?.claims?.['Communication.note-text']).toBe('second note');
    });
  });

  describe('process (claims-only entries)', () => {
    it('should accept an entry with meta.claims and no resource', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'emergency-intake-thread-id',
        iss: 'did:web:api.acme.org:individual:abc:device:xyz',
        aud: 'did:web:api.acme.org',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'Communication:EmergencyIntake',
                  'Communication.subject': 'did:web:api.acme.org:individual:abc',
                  'Communication.recipient': 'did:web:api.acme.org:individual:abc',
                  'Communication.sent': '2025-11-27T20:00:00Z',
                  'Communication.text': 'Alergias: soy alérgico al látex.',
                },
              },
              request: { method: 'POST', url: 'individual/org.hl7.fhir.api/Communication' },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'emergency',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      expect(response.body?.resourceType).toBe('Bundle');
      const data = (response.body as any).data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].type).toBe('CommMsgExtended');
      expect(data[0].resource?.body?.data?.some((d: DataEntry) => d.type === 'Annotation')).toBe(true);
    });

    it('should accept a FHIR Bundle entry[] payload with meta.claims and no resource', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'emergency-intake-thread-id-entry',
        iss: 'did:web:api.acme.org:individual:abc:device:xyz',
        aud: 'did:web:api.acme.org',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'Communication:EmergencyIntake',
                  'Communication.subject': 'did:web:api.acme.org:individual:abc',
                  'Communication.recipient': 'did:web:api.acme.org:individual:abc',
                  'Communication.sent': '2025-11-27T20:00:00Z',
                  'Communication.text': 'Alergias: soy alérgico al látex.',
                },
              },
              request: { method: 'POST', url: 'individual/org.hl7.fhir.api/Communication' },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'emergency',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      expect(response.body?.resourceType).toBe('Bundle');
      const data = (response.body as any).data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].type).toBe('CommMsgExtended');
      expect(data[0].resource?.body?.data?.some((d: DataEntry) => d.type === 'Annotation')).toBe(true);
    });
  });

  describe('process (attachment to DocumentReference projection)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:abc';

    it.each([
      ['application/fhir+json', Buffer.from(JSON.stringify({ resourceType: 'Observation', status: 'final' }), 'utf8').toString('base64')],
      ['application/pdf', Buffer.from('%PDF-1.7 fake', 'utf8').toString('base64')],
      ['image/png', Buffer.from('png-binary', 'utf8').toString('base64')],
      ['image/jpeg', Buffer.from('jpg-binary', 'utf8').toString('base64')],
    ])('persists DocumentReference projection for %s', async (contentType, dataBase64) => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: `thid-${contentType}`,
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-audit-001',
                  'Communication.subject': subjectDid,
                  'Communication.recipient': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                recipient: [{ reference: subjectDid }],
                payload: [{ contentAttachment: { contentType, data: dataBase64, title: 'sample' } }],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      expect(record['DocumentReference.subject'] || record['org.hl7.fhir.r4.DocumentReference.subject']).toBe(subjectDid);
      expect(record['DocumentReference.contenttype'] || record['org.hl7.fhir.r4.DocumentReference.contenttype']).toBe(contentType);
      expect(String(record['DocumentReference.identifier'] || record['org.hl7.fhir.r4.DocumentReference.identifier']).startsWith('urn:uuid:')).toBe(true);
      expect(String(record['DocumentReference.contenthash'] || record['org.hl7.fhir.r4.DocumentReference.contenthash']).startsWith('z')).toBe(true);
    });

    it('persists DocumentReference projection when Communication carries an embedded DocumentReference attachment', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const embeddedDocumentReference = {
        resourceType: 'DocumentReference',
        id: 'docref-ips-001',
        subject: { reference: subjectDid },
        date: '2026-05-17T10:00:00Z',
        description: 'IPS Medication Summary',
        identifier: [{ value: 'urn:uuid:docref-ips-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-medications.json',
              data: Buffer.from(JSON.stringify({ resourceType: 'Bundle', type: 'document', entry: [] }), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thid-docref-embedded',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    title: 'docref.json',
                    data: Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64'),
                  },
                }],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      expect(record['DocumentReference.subject'] || record['org.hl7.fhir.r4.DocumentReference.subject']).toBe(subjectDid);
      expect(record['DocumentReference.identifier'] || record['org.hl7.fhir.r4.DocumentReference.identifier']).toBe('urn:uuid:docref-ips-001');
      expect(record['DocumentReference.description'] || record['org.hl7.fhir.r4.DocumentReference.description']).toBe('IPS Medication Summary');
      expect(record['DocumentReference.contenttype'] || record['org.hl7.fhir.r4.DocumentReference.contenttype']).toBe('application/fhir+json');
    });
  });

  describe('process (FHIR Bundle resource projections)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:bundle-subject-001';

    it('projects IPS resources from an attached document bundle with indexed claims', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-001',
              status: 'final',
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-001',
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: { text: 'Paracetamol 500mg' },
              identifier: [{ value: 'urn:uuid:medication-001' }],
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'observation-001',
              status: 'final',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T11:00:00Z',
              code: {
                coding: [{ system: 'http://loinc.org', code: '8310-5' }],
                text: 'Body temperature',
              },
              identifier: [{ value: 'urn:uuid:observation-001' }],
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-bundle-projection-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-bundle-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                  'Composition.section': 'LOINC|10160-0',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-medications.json',
                      data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const observationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');

      const medicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      expect(medicationPut).toBeDefined();
      const medicationRecord = (medicationPut?.[1] as any[])[0];
      expect(medicationRecord.id).toBe('medication-001');
      expect(
        medicationRecord['MedicationStatement.subject']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.subject'],
      ).toBe(subjectDid);
      expect(
        medicationRecord['MedicationStatement.identifier']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.identifier'],
      ).toBe('urn:uuid:medication-001');
      expect(medicationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.identifier', value: 'urn:uuid:medication-001' }),
        ]),
      );

      const observationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(observationPut).toBeDefined();
      const observationRecord = (observationPut?.[1] as any[])[0];
      expect(observationRecord.id).toBe('observation-001');
      expect(
        observationRecord['Observation.subject']
        || observationRecord['org.hl7.fhir.api.Observation.subject'],
      ).toBe(subjectDid);
      expect(
        observationRecord['Observation.identifier']
        || observationRecord['org.hl7.fhir.api.Observation.identifier'],
      ).toBe('urn:uuid:observation-001');
      expect(observationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.identifier', value: 'urn:uuid:observation-001' }),
        ]),
      );
    });

    it('projects IPS resources when Communication attachment contains a DocumentReference with a document bundle attachment', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-embedded-001',
              status: 'final',
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-embedded-001',
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: { text: 'Ibuprofen 400mg' },
              identifier: [{ value: 'urn:uuid:medication-embedded-001' }],
            },
          },
        ],
      };
      const embeddedDocumentReference = {
        resourceType: 'DocumentReference',
        subject: { reference: subjectDid },
        identifier: [{ value: 'urn:uuid:docref-embedded-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-medications.json',
              data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-bundle-docref-projection-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-bundle-docref-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                  'Composition.section': 'LOINC|10160-0',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-document-reference.json',
                      data: Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const medicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      expect(medicationPut).toBeDefined();
      const medicationRecord = (medicationPut?.[1] as any[])[0];
      expect(medicationRecord.id).toBe('medication-embedded-001');
      expect(
        medicationRecord['MedicationStatement.identifier']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.identifier'],
      ).toBe('urn:uuid:medication-embedded-001');
    });
  });

  describe('process (Consent projections from Communication)', () => {
    const subjectDid = EXAMPLE_SUBJECT_DID;
    const tenantVaultId = 'health-care_acme';
    const consentSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'consents');
    const rulesSectionId = getIndividualSectionId(subjectDid, 'rules');
    const attachmentsSectionId = getIndividualSectionId(subjectDid, 'attachments');
    const communicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'communications');
    const allSectionsWildcard = '*';
    const consentBundleSummaryNote = 'Bundle of Consents containing: 0 personal consents, 1 professional consent, 1 organizational consent, 1 jurisdictional consent.';
    const communicationFormat = knownDomainsReversedEnum['org.hl7.fhir.r4'];
    const consentClaimsContext = knownDomainsReversedEnum['org.hl7.fhir.api'];

    it('persists three separate consent projections, rules, and attachments from one Communication payload', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const makeConsentResource = (
        identifier: string,
        actorIdentifier: string,
        purpose: string,
        action: string,
        attachmentText: string,
      ) => ({
        resourceType: 'Consent',
        status: 'active',
        meta: {
          claims: {
            '@context': consentClaimsContext,
            [ClaimConsent.decision]: ConsentDecisions.Permit,
            [ClaimConsent.subject]: subjectDid,
            [ClaimConsent.identifier]: identifier,
            [ClaimConsent.grantee]: actorIdentifier,
            [ClaimConsent.date]: EXAMPLE_CONSENT_DATE,
            [ClaimConsent.purpose]: purpose,
            [ClaimConsent.action]: action,
            [ClaimConsent.actorIdentifier]: actorIdentifier,
            [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
            [ClaimConsent.attachmentContentType]: ODRL_MEDIA_TYPE,
            [ClaimConsent.attachmentData]: Buffer.from(
              JSON.stringify({ agreement: attachmentText }),
              'utf8',
            ).toString('base64'),
          },
        },
      });

      const consentResources = [
        makeConsentResource(
          buildIdentifierUuidForTesting('consent', 'professional', 1),
          EXAMPLE_EMAIL_PROFESSIONAL,
          HealthcareConsentPurposes.Treatment,
          allSectionsWildcard,
          'professional full IPS access',
        ),
        makeConsentResource(
          buildIdentifierUuidForTesting('consent', 'organization', 1),
          EXAMPLE_PROVIDER_ORGANIZATION_DID,
          HealthcareConsentPurposes.EmergencyTreatment,
          HealthcareConsentActions.PatientSummaryDocument,
          'organization emergency treatment access',
        ),
        makeConsentResource(
          buildIdentifierUuidForTesting('consent', 'jurisdictions', 1),
          `${EXAMPLE_HEALTHCARE_JURISDICTION},${EXAMPLE_SECONDARY_EU_COUNTRY}`,
          HealthcareConsentPurposes.EmergencyTreatment,
          HealthcareConsentActions.PatientSummaryDocument,
          'jurisdiction emergency treatment access',
        ),
      ];

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-consent-projection-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: `${communicationFormat}.Bundle`,
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': communicationFormat,
                  'Communication.identifier': 'comm-consent-bundle-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-06-04T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                note: [{ text: consentBundleSummaryNote }],
                payload: consentResources.map((consentResource, index) => ({
                  contentAttachment: {
                    contentType: FHIR_JSON_MEDIA_TYPE,
                    title: `consent-${index + 1}.json`,
                    data: Buffer.from(JSON.stringify(consentResource), 'utf8').toString('base64'),
                  },
                })),
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: communicationFormat as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const consentPutCalls = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === consentSectionId,
      );
      expect(consentPutCalls).toHaveLength(3);
      expect(consentPutCalls.map((args) => getClaimValue((args[1] as any[])[0], ClaimConsent.identifier)).sort()).toEqual([
        buildIdentifierUuidForTesting('consent', 'jurisdictions', 1),
        buildIdentifierUuidForTesting('consent', 'organization', 1),
        buildIdentifierUuidForTesting('consent', 'professional', 1),
      ]);

      const rulePutCalls = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === rulesSectionId,
      );
      expect(rulePutCalls).toHaveLength(3);
      expect(rulePutCalls.map((args) => getClaimValue((args[1] as any[])[0], ClaimConsent.actorIdentifier)).sort()).toEqual([
        `${EXAMPLE_HEALTHCARE_JURISDICTION},${EXAMPLE_SECONDARY_EU_COUNTRY}`,
        EXAMPLE_PROVIDER_ORGANIZATION_DID,
        EXAMPLE_EMAIL_PROFESSIONAL,
      ]);

      const attachmentPutCalls = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === attachmentsSectionId,
      );
      expect(attachmentPutCalls).toHaveLength(3);

      const communicationPutCalls = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === communicationsSectionId,
      );
      expect(communicationPutCalls).toHaveLength(1);
      expect((communicationPutCalls[0][1] as any[])[0]['Communication.note-text']).toBe(consentBundleSummaryNote);
    });
  });

  describe('process (subject-scoped communication channel persistence)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:xyz';

    it('persists an auditable CommMsgExtended channel record per subject', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-audit-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-audit-001',
                  'Communication.subject': subjectDid,
                  'Communication.recipient': subjectDid,
                  'Communication.sender': 'did:web:operator.example',
                  'Communication.sent': '2026-05-17T12:30:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                recipient: [{ reference: subjectDid }],
                sender: { reference: 'did:web:operator.example' },
                sent: '2026-05-17T12:30:00Z',
                note: [{ text: 'Permission update requested' }],
                payload: [
                  {
                    contentAttachment: {
                      id: 'zb2rhfJk6M9MHiMagUhM6YJ6R7Sx9nN2m7r8cfDkQ2uYbGxZq',
                      contentType: 'application/pdf',
                      data: Buffer.from('fake-pdf-content', 'utf8').toString('base64'),
                      title: 'request.pdf',
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const commSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'communications');
      const channelPutCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === commSectionId);
      expect(channelPutCalls.length).toBeGreaterThan(0);
      const channelRecord = (channelPutCalls[0][1] as any[])[0];
      expect(channelRecord.id).toBe('comm-audit-001');
      expect(channelRecord.type).toBe('CommMsgExtended');
      expect(channelRecord.thid).toBe('thread-audit-001');
      expect(channelRecord['Communication.identifier']).toBe('comm-audit-001');
      expect(channelRecord['Communication.subject']).toBe(subjectDid);
      expect(channelRecord['Communication.sent']).toBe('2026-05-17T12:30:00Z');
      expect(channelRecord['Communication.note-text']).toBe('Permission update requested');
      expect(channelRecord.meta?.payloadCount).toBe(1);
      expect(channelRecord.meta?.documentReferenceCount).toBe(1);
      expect(channelRecord['Communication.content-reference']).toContain('DocumentReference/documentreference-from-communication-');
      expect(channelRecord.resource?.body?.data?.some((item: DataEntry) => item.type === 'Attachment')).toBe(true);
    });
  });

  describe('process (embedded subject search forwarding)', () => {
    it('forwards Subject/_search referenced in Communication payload with attached Parameters', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockIndividualManager.process.mockResolvedValue({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-subject-search-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Subject-search-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'searchset',
                total: 3,
                data: [{ id: 'consent-1' }, { id: 'consent-2' }, { id: 'consent-3' }],
              },
            },
          ],
        },
      } as any);

      const parametersResource = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'subject', valueString: EXAMPLE_SUBJECT_DID },
        ],
      };

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-search-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              type: 'Communication',
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: EXAMPLE_SUBJECT_DID },
                payload: [
                  {
                    contentReference: {
                      reference: 'individual/org.hl7.fhir.api/Subject/_search',
                    },
                    contentAttachment: {
                      contentType: FHIR_JSON_MEDIA_TYPE,
                      title: 'subject-search-parameters.json',
                      data: Buffer.from(JSON.stringify(parametersResource), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      };

      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe('Subject-search-response-v1.0');

      const forwardedJob = mockIndividualManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('_search');
      expect((forwardedJob.content as any)?.body).toEqual(parametersResource);
    });
  });
});
