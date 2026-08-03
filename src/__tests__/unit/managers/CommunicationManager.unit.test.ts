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
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  buildCommunicationParticipantSearchParameters,
  buildExampleCommunicationParticipantProjection,
  buildExampleCommunicationParticipantSearchInput,
  CommunicationParticipantPrefixes,
} from 'gdc-common-utils-ts';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockCompositionManager: { process: jest.Mock };
  let mockIndividualManager: { process: jest.Mock };
  const testServerDid = 'did:web:test-server.com';

  beforeEach(() => {
    // Create a new mock instance for each test
    mockTenantsCacheManager = {
      getTenantDid: jest.fn(),
      tenantExists: jest.fn(async () => true),
    } as unknown as jest.Mocked<TenantsCacheManager>;
    mockVaultRepository = {
      vaultExists: jest.fn(async () => false),
      put: jest.fn(async () => undefined),
      query: jest.fn(async () => []),
      listContainersInSection: jest.fn(async () => []),
      getAllSections: jest.fn(async () => []),
    } as unknown as jest.Mocked<IVaultRepository>;
    mockCompositionManager = {
      process: jest.fn(),
    };
    mockIndividualManager = {
      process: jest.fn(),
    };
    
    communicationManager = new CommunicationManager({
      tenantsCacheManager: mockTenantsCacheManager,
      vaultRepository: mockVaultRepository,
      compositionManager: mockCompositionManager as any,
      individualManager: mockIndividualManager as any,
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

    it('does not persist the same DocumentReference attachment twice when contenthash already exists', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const dataBase64 = Buffer.from('%PDF-1.7 fake', 'utf8').toString('base64');
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thid-pdf-dedupe-1',
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
                payload: [{ contentAttachment: { contentType: 'application/pdf', data: dataBase64, title: 'sample' } }],
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
      const firstDocRefPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === docRefSectionId,
      );
      expect(firstDocRefPuts).toHaveLength(1);

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-docref' }] as any);

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: { ...decoded, thid: 'thid-pdf-dedupe-2' },
      });

      const secondDocRefPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === docRefSectionId,
      );
      expect(secondDocRefPuts).toHaveLength(0);
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

    it('normalizes a native EHR section update without meta.claims and never invents a medication section', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const section = 'LOINC|48765-2';
      const sectionBatch = {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-section-update-001',
            identifier: [{ value: 'urn:uuid:allergy-section-update-001' }],
            patient: { reference: subjectDid },
            language: 'es',
            code: {
              text: 'http://snomed.info/sct|91935009',
              coding: [{ system: 'http://snomed.info/sct', code: '91935009', display: 'Peanut' }],
            },
            meta: { claims: {
              'AllergyIntolerance.code-text': 'Cacahuete',
              'AllergyIntolerance.code-display': 'Peanut',
            } },
            clinicalStatus: { coding: [{ code: 'active' }] },
            category: ['food'],
            criticality: 'high',
            onsetDateTime: '2026-07-24T10:00:00Z',
          },
        }],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-allergy-section-update-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            resource: {
              resourceType: 'Communication',
              status: 'completed',
              subject: { reference: subjectDid },
              topic: {
                coding: [{ system: 'http://loinc.org', code: '48765-2' }],
              },
              payload: [
                {
                contentAttachment: {
                  contentType: 'application/fhir+json',
                  data: Buffer.from(JSON.stringify(sectionBatch), 'utf8').toString('base64'),
                },
                },
              ],
            },
          }],
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
      const allergySectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'allergies');
      const allergyPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === allergySectionId,
      );
      expect(allergyPut).toBeDefined();
      const allergyRecord = (allergyPut?.[1] as any[])[0];
      expect(
        allergyRecord['AllergyIntolerance.identifier']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.identifier']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.identifier'],
      ).toBe('urn:uuid:allergy-section-update-001');
      expect(
        allergyRecord['AllergyIntolerance.subject']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.subject']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.subject'],
      ).toBe(subjectDid);
      expect(
        allergyRecord['AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.code'],
      ).toBe('http://snomed.info/sct|91935009');
      expect(
        allergyRecord['AllergyIntolerance.code-text']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-text'],
      ).toBe('Cacahuete');
      expect(
        allergyRecord['AllergyIntolerance.CodeTextLocal']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.CodeTextLocal'],
      ).toBe('Cacahuete');
      expect(
        allergyRecord['AllergyIntolerance.code-display']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-display'],
      ).toBe('Peanut');
      expect(
        allergyRecord['AllergyIntolerance.code-text']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code-text'],
      ).not.toBe(
        allergyRecord['AllergyIntolerance.code']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.code'],
      );
      expect(
        allergyRecord['AllergyIntolerance.clinical-status']
        || allergyRecord['org.hl7.fhir.api.AllergyIntolerance.clinical-status']
        || allergyRecord['org.hl7.fhir.r4.AllergyIntolerance.clinical-status'],
      ).toBe('active');
      const compositionRecords = mockVaultRepository.put.mock.calls
        .filter((args) => args[0] === tenantVaultId && args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'composition'))
        .flatMap((args) => args[1] as any[]);
      const projectedSections = compositionRecords.map((record) =>
        record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section']);
      expect(projectedSections).toEqual([section]);
      expect(projectedSections).not.toContain('LOINC|10160-0');
    });

    it('rejects an unscoped clinical batch instead of accepting an update that reads back empty', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const unscopedBatch = {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-unscoped-001',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'AllergyIntolerance.identifier': 'urn:uuid:allergy-unscoped-001',
              'AllergyIntolerance.subject': subjectDid,
            } },
          },
        }],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-allergy-unscoped-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.r4.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            meta: { claims: {
              '@context': 'org.hl7.fhir.r4',
              'Communication.subject': subjectDid,
            } },
            resource: {
              resourceType: 'Communication',
              status: 'completed',
              subject: { reference: subjectDid },
              payload: [{
                contentAttachment: {
                  contentType: 'application/fhir+json',
                  data: Buffer.from(JSON.stringify(unscopedBatch), 'utf8').toString('base64'),
                },
              }],
            },
          }],
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

      // Step 1: process the same generic Communication path that used to return a false success.
      const result = await communicationManager.process(job);

      // Step 2: expose the contract error in the batch response and persist no clinical projection.
      expect((result.body as any).data[0].response.status).toBe('500');
      expect((result.body as any).data[0].response.outcome.issue[0].details.text)
        .toContain('requires one explicit Composition.section');
      expect(mockVaultRepository.put.mock.calls.some(
        (args) => args[2] === getSubjectScopedSectionId(subjectDid, 'individual', 'allergies'),
      )).toBe(false);
    });

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
              language: 'es',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: {
                text: 'Paracetamol 500mg',
                coding: [{
                  system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                  code: '161',
                  display: 'Paracetamol 500 MG Oral Tablet',
                  userSelected: true,
                }],
              },
              identifier: [{ value: 'urn:uuid:medication-001' }],
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'observation-001',
              status: 'final',
              language: 'es',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T11:00:00Z',
              code: {
                coding: [{
                  system: 'http://loinc.org',
                  code: '85354-9',
                  display: 'Blood pressure panel with all children optional',
                  userSelected: true,
                }],
                text: 'Tension arterial',
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
      expect(
        medicationRecord['MedicationStatement.CodeDisplay']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.CodeDisplay'],
      ).toBe('Paracetamol 500 MG Oral Tablet');
      expect(
        medicationRecord['MedicationStatement.CodeTextLocal']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.CodeTextLocal'],
      ).toBe('Paracetamol 500mg');
      expect(
        medicationRecord['MedicationStatement.language']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.language'],
      ).toBe('es');
      expect(
        medicationRecord['MedicationStatement.user-selected']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.user-selected'],
      ).toBe('true');
      expect(medicationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.identifier', value: 'urn:uuid:medication-001' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.CodeDisplay', value: 'Paracetamol 500 MG Oral Tablet' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.CodeTextLocal', value: 'Paracetamol 500mg' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.language', value: 'es' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.user-selected', value: 'true' }),
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
      expect(
        observationRecord['Observation.CodeDisplay']
        || observationRecord['org.hl7.fhir.api.Observation.CodeDisplay'],
      ).toBe('Blood pressure panel with all children optional');
      expect(
        observationRecord['Observation.CodeTextLocal']
        || observationRecord['org.hl7.fhir.api.Observation.CodeTextLocal'],
      ).toBe('Tension arterial');
      expect(
        observationRecord['Observation.language']
        || observationRecord['org.hl7.fhir.api.Observation.language'],
      ).toBe('es');
      expect(
        observationRecord['Observation.user-selected']
        || observationRecord['org.hl7.fhir.api.Observation.user-selected'],
      ).toBe('true');
      expect(observationRecord.indexed?.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.subject', value: subjectDid }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.identifier', value: 'urn:uuid:observation-001' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.CodeDisplay', value: 'Blood pressure panel with all children optional' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.CodeTextLocal', value: 'Tension arterial' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.language', value: 'es' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.user-selected', value: 'true' }),
        ]),
      );
    });

    it('keeps DocumentReference attachments working as a compatibility wrapper around a document bundle', async () => {
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

    it('projects one Composition index per IPS section into individual and digitaltwin scopes', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-sections-001',
              status: 'final',
              subject: { reference: subjectDid },
              type: {
                coding: [{ system: 'http://loinc.org', code: '60591-5' }],
              },
              section: [
                {
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '10160-0' }],
                  },
                },
                {
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '8716-3' }],
                  },
                },
              ],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-sections-001',
              status: 'active',
              subject: { reference: subjectDid },
              medicationCodeableConcept: { text: 'Paracetamol 500mg' },
              identifier: [{ value: 'urn:uuid:medication-sections-001' }],
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'observation-sections-001',
              status: 'final',
              subject: { reference: subjectDid },
              code: {
                coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }],
                text: 'Blood pressure',
              },
              identifier: [{ value: 'urn:uuid:observation-sections-001' }],
            },
          },
        ],
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
        content: {
          jti: randomUUID(),
          thid: 'thread-composition-sections-001',
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
                    'Communication.identifier': 'comm-composition-sections-001',
                    'Communication.subject': subjectDid,
                    'Communication.sent': '2026-05-22T10:00:00Z',
                    'Composition.type': 'http://loinc.org|60591-5',
                  },
                },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-sections.json',
                        data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          } as any,
        },
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const individualCompositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');
      const digitalTwinCompositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
      const compositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) =>
          args[0] === tenantVaultId
          && (args[2] === individualCompositionSectionId || args[2] === digitalTwinCompositionSectionId),
      );

      expect(compositionPuts).toHaveLength(4);
      const projectedSections = compositionPuts.flatMap((args) =>
        ((args[1] as any[]) || []).map((record) =>
          record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section'],
        ),
      );
      expect(projectedSections).toEqual(expect.arrayContaining([
        'LOINC|10160-0',
        'LOINC|8716-3',
      ]));
    });

    it('does not project duplicate clinical resources when the replayed IPS changes container ids, dates, and narrative text', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const buildDocumentBundle = (suffix: string, compositionDate: string) => ({
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: `ips-composition-${suffix}`,
              status: 'final',
              date: compositionDate,
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Narrative ${suffix}</div>`,
              },
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
              section: [{ code: { coding: [{ system: 'http://loinc.org', code: '10160-0' }] } }],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: `medication-${suffix}`,
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: {
                text: 'Paracetamol 500mg',
                coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '161' }],
              },
              identifier: [{ value: 'urn:uuid:medication-stable-001' }],
              meta: {
                source: `ips-${suffix}`,
              },
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Medication ${suffix}</div>`,
              },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: `observation-${suffix}`,
              status: 'final',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T11:00:00Z',
              code: {
                coding: [{ system: 'http://loinc.org', code: '8310-5' }],
                text: 'Body temperature',
              },
              identifier: [{ value: 'urn:uuid:observation-stable-001' }],
              meta: {
                tag: [{ code: `ips-${suffix}` }],
              },
              text: {
                status: 'generated',
                div: `<div xmlns="http://www.w3.org/1999/xhtml">Observation ${suffix}</div>`,
              },
            },
          },
        ],
      });

      const makeDecoded = (thid: string, suffix: string, sent: string): IDecodedDidcommPayload => ({
        jti: randomUUID(),
        thid,
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
                  'Communication.identifier': `comm-${suffix}`,
                  'Communication.subject': subjectDid,
                  'Communication.sent': sent,
                  'Composition.section': 'LOINC|10160-0',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                sent,
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: `ips-${suffix}.json`,
                      data: Buffer.from(JSON.stringify(buildDocumentBundle(suffix, sent)), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      });

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
        content: makeDecoded('thread-ips-replay-1', 'v1', '2026-05-22T10:00:00Z'),
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const medicationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const observationsSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');
      const firstMedicationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      const firstObservationPut = mockVaultRepository.put.mock.calls.find(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(firstMedicationPut).toBeDefined();
      expect(firstObservationPut).toBeDefined();

      const firstMedicationRecord = (firstMedicationPut?.[1] as any[])[0];
      const firstObservationRecord = (firstObservationPut?.[1] as any[])[0];
      const medicationVersionId =
        firstMedicationRecord['MedicationStatement.meta.versionId']
        || firstMedicationRecord['org.hl7.fhir.api.MedicationStatement.meta.versionId'];
      const observationVersionId =
        firstObservationRecord['Observation.meta.versionId']
        || firstObservationRecord['org.hl7.fhir.api.Observation.meta.versionId'];
      expect(typeof medicationVersionId).toBe('string');
      expect(typeof observationVersionId).toBe('string');

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockImplementation(async (_tenantVaultId, query) => {
        const where = Array.isArray(query?.where) ? query.where : [];
        const matchesMedication = where.some(
          (condition: any) => condition?.name === 'MedicationStatement.meta.versionId' && condition?.value === medicationVersionId,
        );
        const matchesObservation = where.some(
          (condition: any) => condition?.name === 'Observation.meta.versionId' && condition?.value === observationVersionId,
        );
        return matchesMedication || matchesObservation ? [{ id: 'existing-projection' }] as any : [];
      });

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: makeDecoded('thread-ips-replay-2', 'v2', '2026-06-01T09:30:00Z'),
      });

      const secondMedicationPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === medicationsSectionId,
      );
      const secondObservationPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === observationsSectionId,
      );
      expect(secondMedicationPuts).toHaveLength(0);
      expect(secondObservationPuts).toHaveLength(0);
    });

    it('does not persist the same Composition projection twice when the document is resent in another Communication thread', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-stable-001',
              identifier: [{ value: 'urn:uuid:ips-composition-stable-001' }],
              status: 'final',
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
              section: [{ code: { coding: [{ system: 'http://loinc.org', code: '10160-0' }] } }],
            },
          },
        ],
      };

      const makeDecoded = (thid: string): IDecodedDidcommPayload => ({
        jti: randomUUID(),
        thid,
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
                  'Communication.sent': '2026-05-22T10:00:00Z',
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
                      title: 'ips-document.json',
                      data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        } as any,
      });

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
        content: makeDecoded('thread-composition-stable-1'),
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');
      const firstCompositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === compositionSectionId,
      );
      expect(firstCompositionPuts).toHaveLength(1);
      const firstCompositionRecord = (firstCompositionPuts[0][1] as any[])[0];
      expect(
        firstCompositionRecord['Composition.identifier']
        || firstCompositionRecord['org.hl7.fhir.r4.Composition.identifier'],
      ).toBe('urn:uuid:ips-composition-stable-001');

      mockVaultRepository.put.mockClear();
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-composition' }] as any);

      await communicationManager.process({
        ...job,
        id: randomUUID(),
        content: makeDecoded('thread-composition-stable-2'),
      });

      const secondCompositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) => args[0] === tenantVaultId && args[2] === compositionSectionId,
      );
      expect(secondCompositionPuts).toHaveLength(0);
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

  describe('process (embedded Bundle/_search request)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:ips-search-subject-001';

    it('executes Bundle/_search referenced in Communication.contentReference and returns the search response', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-ips-search-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-search-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
                entry: [{ resource: { resourceType: 'Composition' } }],
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-ips-search-001',
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
                  'Communication.identifier': 'comm-ips-search-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-06-02T10:00:00Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Bundle/_search?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=http%3A%2F%2Floinc.org%7C60591-5`,
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
      expect(data[0]?.type).toBe('Bundle-search-response-v1.0');
      expect(data[0]?.resource?.type).toBe('document');
      expect(mockCompositionManager.process).toHaveBeenCalledTimes(1);
      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Bundle');
      expect(forwardedJob.action).toBe('_search');
      expect((forwardedJob.content as any)?.body?.entry?.[0]?.request?.url).toBe(
        `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=http%3A%2F%2Floinc.org%7C60591-5`,
      );
    });

    it('executes Subject/$summary referenced in Communication.contentReference as a summary operation', async () => {
      // Teaching goal:
      // Prove the public-to-internal boundary: the caller submits one
      // Communication job, and only CommunicationManager delegates its
      // contentReference to the internal summary processor.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-subject-summary-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-summary-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-summary-001',
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
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Subject/$summary?subject=${encodeURIComponent(subjectDid)}`,
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
      // The test calls CommunicationManager only. A portal/BFF must never copy
      // the forwarded job below into a direct Subject/$summary HTTP request.
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe('Bundle-summary-response-v1.0');
      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
      expect((forwardedJob.content as any)?.body?.resourceType).toBe('Parameters');
      expect((forwardedJob.content as any)?.body?.parameter).toEqual([
        { name: 'subject', valueString: subjectDid },
      ]);
    });

    it('uses claims-first FHIR Parameters directly without manufacturing a native payload', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async (forwardedJobInput: unknown) => {
        const forwardedJob = forwardedJobInput as JobRequest;
        return ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-subject-summary-parameters-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [{
            type: 'Bundle-summary-response-v1.0',
            response: { status: '200' },
            resource: {
              resourceType: 'Bundle',
              type: 'document',
              meta: { forwardedBody: (forwardedJob.content as any)?.body },
            },
          }],
        },
        }) as any;
      });

      const parameters = {
        resourceType: 'Parameters',
        parameter: [
          { name: 'subject', valueString: subjectDid },
          { name: 'document-type', valueString: 'http://loinc.org|60591-5' },
          { name: 'section', valueString: 'LOINC|48765-2' },
        ],
      };
      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-subject-summary-parameters-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [{
            type: 'Communication',
            resource: {
              resourceType: 'Communication',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'Communication.status': 'completed',
                  'Communication.subject': subjectDid,
                  'Communication.content-reference': 'individual/org.hl7.fhir.api/Subject/$summary',
                  'Communication.content-attachment-type': 'application/fhir+json',
                  'Communication.content-attachment-data':
                    Buffer.from(JSON.stringify(parameters), 'utf8').toString('base64'),
                },
              },
            },
          }],
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
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      expect((decoded.body as any).data[0].resource.payload).toBeUndefined();
      await communicationManager.process(job);

      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
      expect((forwardedJob.content as any)?.body).toEqual(parameters);
    });

    it('treats Patient/$summary as an alias of Subject/$summary', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      mockCompositionManager.process.mockImplementation(async () => ({
        jti: randomUUID(),
        iss: testServerDid,
        aud: 'did:web:sender.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        thid: 'thread-patient-summary-001',
        type: 'transaction-response',
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [
            {
              type: 'Bundle-summary-response-v1.0',
              response: { status: '200' },
              resource: {
                resourceType: 'Bundle',
                type: 'document',
              },
            },
          ],
        },
      }) as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'thread-patient-summary-001',
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
                subject: { reference: subjectDid },
                payload: [
                  {
                    contentReference: {
                      reference: `individual/org.hl7.fhir.r4/Patient/$summary?subject=${encodeURIComponent(subjectDid)}`,
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

      const forwardedJob = mockCompositionManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('$summary');
    });
  });

  describe('process (embedded Subject/_search request)', () => {
    it('forwards Subject/_search referenced in Communication payload with attached Parameters', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      (mockIndividualManager.process as any).mockResolvedValue({
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
          { name: 'subject', valueString: 'did:web:api.acme.org:individual:123' },
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
                subject: { reference: 'did:web:api.acme.org:individual:123' },
                payload: [
                  {
                    contentReference: {
                      reference: 'individual/org.hl7.fhir.api/Subject/_search',
                    },
                    contentAttachment: {
                      contentType: 'application/fhir+json',
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
      expect(mockIndividualManager.process).toHaveBeenCalledTimes(1);
      const forwardedJob = mockIndividualManager.process.mock.calls[0][0] as JobRequest;
      expect(forwardedJob.resourceType).toBe('Subject');
      expect(forwardedJob.action).toBe('_search');
      expect((forwardedJob.content as any)?.body).toEqual(parametersResource);
    });
  });

  describe('participant search and indexing', () => {
    it('stores normalized participant index attributes in channel projections', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const fhirResource = {
        resourceType: 'Communication' as const,
        status: 'completed',
        subject: { reference: 'did:web:subject.example' },
        sender: { reference: 'mailto:Sender@Example.org' },
        recipient: [
          { reference: 'did:web:member.example' },
          { reference: '+34 600 111 222' },
        ],
        sent: '2026-06-15T10:00:00Z',
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
        content: {
          jti: randomUUID(),
          thid: 'thread-participant-index-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:gw.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            data: [{ resource: fhirResource }],
          },
        } as any,
      };

      await communicationManager.process(job);

      const communicationSectionWrite = mockVaultRepository.put.mock.calls.find((call) =>
        String(call[2] || '').includes('communications'),
      );
      expect(communicationSectionWrite).toBeDefined();
      const storedRecord = communicationSectionWrite?.[1]?.[0] as Record<string, any>;
      expect(storedRecord.indexed?.attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Communication.sender-token', value: 'email:sender@example.org' }),
        expect.objectContaining({ name: 'Communication.recipient-token', value: 'did:web:member.example' }),
        expect.objectContaining({ name: 'Communication.recipient-token', value: 'tel:+34600111222' }),
      ]));
    });

    it('searches communication channel records through Parameters criteria and wildcard subject scope', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);

      const firstSection = getSubjectScopedSectionId('did:web:subject.example', 'individual', 'communications');
      const secondSection = getSubjectScopedSectionId('did:web:subject.example:secondary', 'individual', 'communications');
      (mockVaultRepository.getAllSections as unknown as jest.Mock<any>).mockResolvedValue([
        firstSection,
        secondSection,
        'test_individual_dictionary_abc',
      ]);
      (mockVaultRepository.listContainersInSection as unknown as jest.Mock<any>).mockImplementation(async (...args: any[]) => {
        const sectionId = args[1] as string;
        if (sectionId === firstSection) {
          const firstProjection = buildExampleCommunicationParticipantProjection();
          return [
            {
              ...firstProjection,
              type: 'CommMsgExtended',
              resource: { id: 'comm-1' },
              [CommunicationClaim.Identifier]: 'comm-1',
              [CommunicationClaim.Subject]: firstProjection.subject,
              [CommunicationClaim.Sender]: firstProjection.sender,
              [CommunicationClaim.Recipient]: (firstProjection.recipients as string[]).join(','),
              [CommunicationClaim.Category]: firstProjection.category,
              [CommunicationClaim.Topic]: firstProjection.topic,
              [CommunicationClaim.Sent]: '2026-06-15T10:00:00Z',
            },
          ];
        }
        const secondProjection = buildExampleCommunicationParticipantProjection({
            id: 'communication-participant-record-002',
            subject: 'did:web:subject.example:secondary',
            recipients: ['did:web:somebody.else'],
          });
        return [{
          ...secondProjection,
          type: 'CommMsgExtended',
          resource: { id: 'comm-2' },
          [CommunicationClaim.Identifier]: 'comm-2',
          [CommunicationClaim.Subject]: secondProjection.subject,
          [CommunicationClaim.Sender]: secondProjection.sender,
          [CommunicationClaim.Recipient]: (secondProjection.recipients as string[]).join(','),
          [CommunicationClaim.Category]: secondProjection.category,
          [CommunicationClaim.Topic]: secondProjection.topic,
          [CommunicationClaim.Sent]: '2026-06-15T11:00:00Z',
        }];
      });

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
        action: '_search',
        content: {
          jti: randomUUID(),
          thid: 'thread-participant-search-001',
          iss: 'did:web:searcher.example',
          aud: 'did:web:gw.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: buildCommunicationParticipantSearchParameters(
            buildExampleCommunicationParticipantSearchInput({
              subject: CommunicationParticipantPrefixes.Wildcard,
            }),
          ),
        } as any,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any).data;
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('communication-participant-record-001');
      expect(data[0].meta.claims[CommunicationClaim.Identifier]).toBe('comm-1');
    });
  });
});
