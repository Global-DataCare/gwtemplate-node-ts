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
import { IssueType } from 'gdc-common-utils-ts/models/issue';

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
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
    
    communicationManager = new CommunicationManager({
      tenantsCacheManager: mockTenantsCacheManager,
      vaultRepository: mockVaultRepository,
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
      expect(result.body.data).toHaveLength(expectedCommMsg.body.data.length);
      
      // 1. Verify Annotation
      const annotationItem = result.body.data.find((item: DataEntry) => item.type === 'Annotation');
      expect(annotationItem).toBeDefined();
      if(annotationItem) {
        expect(annotationItem.resource.text).toEqual(testAppointmentRequestText);
        expect(typeof annotationItem.id).toBe('string');
      }

      // 2. Verify Reference
      const referenceItem = result.body.data.find((item: DataEntry) => item.type === 'Reference');
      const expectedReference = expectedCommMsg.body.data.find((item: any) => item.type === 'Reference');
      expect(referenceItem).toBeDefined();
      expect(expectedReference).toBeDefined();
      if (referenceItem && expectedReference && expectedReference.resource) {
        expect(referenceItem.resource.reference).toEqual(expectedReference.resource.reference);
        expect(typeof referenceItem.id).toBe('string');
      }

      // 3. Verify Attachment
      const attachmentItem = result.body.data.find((item: DataEntry) => item.type === 'Attachment');
      const expectedAttachment = expectedCommMsg.body.data.find((item: any) => item.type === 'Attachment');
      expect(attachmentItem).toBeDefined();
      expect(expectedAttachment).toBeDefined();
      if (attachmentItem && expectedAttachment && expectedAttachment.resource) {
        expect(attachmentItem.resource.contentType).toEqual(expectedAttachment.resource.contentType);
        expect(attachmentItem.resource.data).toEqual(expectedAttachment.resource.data);
        expect(attachmentItem.resource.title).toEqual(expectedAttachment.resource.title);
        expect(typeof attachmentItem.id).toBe('string');
      }
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

    it('should return a 404 OperationOutcome when the tenant DID cannot be resolved', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(undefined as any);

      const decoded: IDecodedDidcommPayload = {
        jti: randomUUID(),
        thid: 'communication-missing-tenant-thread',
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
                  '@context': 'org.hl7.fhir.api',
                  'Communication.identifier': 'comm-missing-tenant-001',
                  'Communication.subject': 'did:web:api.acme.org:individual:abc',
                  'Communication.sent': '2025-11-27T20:00:00Z',
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
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: 'Communication',
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any).data;
      expect(response.body?.resourceType).toBe('Bundle');
      expect(data[0].response.status).toBe('404');
      expect(data[0].response.outcome.issue[0].code).toBe(IssueType.NotFound);
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
      expect(channelRecord['Communication.note']).toBe('Permission update requested');
      expect(channelRecord.meta?.payloadCount).toBe(1);
      expect(channelRecord.meta?.documentReferenceCount).toBe(1);
      expect(channelRecord['Communication.content-reference']).toContain('DocumentReference/documentreference-from-communication-');
      expect(channelRecord.resource?.body?.data?.some((item: DataEntry) => item.type === 'Attachment')).toBe(true);
    });
  });
});
