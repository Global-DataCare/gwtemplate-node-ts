// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Communication ingestion requires authenticated local authors and preserves external provenance.
// Flow contract: Communication ingestion persists authorized resources and
// returns independent per-entry outcomes for mixed clinical batch operations.
// Authorization invariant: only the exact subject's creator or the same
// privately linked verified identity can delete an authored clinical fact.
// Persistence invariant: resources retain author provenance, optional
// submitter audit, and document organization/date; a failed entry never rolls
// back a successful sibling entry.
// TDD contract: write this test red first; make it green only with complete behavior.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/CommunicationManager.unit.test.ts
// Description: Unit tests for the CommunicationManager.
import { DidcommPayloadTypes } from 'gdc-common-utils-ts/constants/didcomm';
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { GatewayRequestEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ObservationStatuses } from 'gdc-common-utils-ts/constants/clinical-statuses';

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
  BundleEditableResourceTypes,
  BundleEditor,
  BundleOperations,
  CommunicationParticipantPrefixes,
  ConsentDecisions,
  ConsentStatuses,
  HealthcareActorRoles,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { DocumentReferenceClaim } from 'gdc-common-utils-ts/models/interoperable-claims/document-reference-claims';
import { BundleTypes } from 'gdc-common-utils-ts/models/bundle-editor-types';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_ALLERGY_IDENTIFIER,
  EXAMPLE_ALLERGY_ONSET_DATE_TIME,
  EXAMPLE_CLINICAL_SECTION_ALLERGIES,
  EXAMPLE_COMMUNICATION_IDENTIFIER,
  EXAMPLE_CONSENT_IDENTIFIER,
  EXAMPLE_CONTENT_TYPE_FHIR_JSON,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_IPS_COMPOSITION_IDENTIFIER,
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_RELATED_PERSON_ROLE,
  EXAMPLE_CLIENT_INSTANCE_UUID,
} from 'gdc-common-utils-ts/examples/shared';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from '../../../utils/ips-bundle';

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockVaultRepository: jest.Mocked<IVaultRepository>;
  let mockCompositionManager: { process: jest.Mock };
  let mockIndividualManager: { process: jest.Mock };
  let storedRecords: Map<string, any>;
  const testServerDid = 'did:web:test-server.com';

  beforeEach(() => {
    // Create a new mock instance for each test
    mockTenantsCacheManager = {
      getTenantDid: jest.fn(),
      tenantExists: jest.fn(async () => true),
    } as unknown as jest.Mocked<TenantsCacheManager>;
    storedRecords = new Map<string, any>();
    mockVaultRepository = {
      vaultExists: jest.fn(async () => false),
      put: jest.fn(async (vaultId: string, items: any[], sectionId?: string) => {
        items.forEach((item) => storedRecords.set(`${vaultId}|${sectionId}|${item.id}`, item));
        return true;
      }),
      get: jest.fn(async (vaultId: string, id: string, sectionId?: string) =>
        storedRecords.get(`${vaultId}|${sectionId}|${id}`)),
      query: jest.fn(async () => []),
      delete: jest.fn(async (vaultId: string, id: string, sectionId?: string) => {
        storedRecords.delete(`${vaultId}|${sectionId}|${id}`);
        return true;
      }),
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

  describe('process (Communication-carried mixed clinical batch)', () => {
    const subjectDid = 'did:web:subject.example:animals:patient-1';
    const creatorDid = 'did:web:clinic-a.example:professionals:vet-1';

    function buildClinicalBatchJob(innerEntries: unknown[], authorDid?: string): JobRequest {
      const attachedBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        ...(authorDid ? { meta: { claims: { 'Composition.author': authorDid } } } : {}),
        data: innerEntries,
      };
      return {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'ca-bc',
        sector: 'animal-care',
        section: 'individual',
        format: 'org.hl7.fhir.api' as any,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: randomUUID(),
          iss: creatorDid,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.api.Bundle',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: 'batch',
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                meta: {
                  claims: {
                    [CommunicationClaim.Subject]: subjectDid,
                    [CommunicationClaim.Sender]: creatorDid,
                    [CommunicationClaim.Topic]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
                    [CommunicationClaim.ContentAttachmentType]: 'application/fhir+json',
                    [CommunicationClaim.ContentAttachmentData]: Buffer
                      .from(JSON.stringify(attachedBundle), 'utf8')
                      .toString('base64'),
                  },
                },
              },
            }],
          },
        } as any,
      };
    }

    it('lets the authenticated creator delete the mistaken record without a version condition', async () => {
      // Step 1. Authoritative storage says who created the record and which version is current.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'immunization-mistake',
        audit: { creatorDid },
        'Immunization.subject': subjectDid,
        'Immunization.meta.versionId': 'version-current',
      } as any);

      // Step 2. The same verified DID conditionally deletes it through the attached batch.
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ImmunizationDelete,
        request: {
          method: HttpRequestMethods.Delete,
          url: 'Immunization/immunization-mistake',
        },
        resource: { resourceType: ResourceTypesFhirR4.Immunization, id: 'immunization-mistake', meta: { claims: {} } },
      }]));

      expect((response.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'immunization-mistake',
          response: expect.objectContaining({ status: String(HttpStatusCodes.NoContent) }),
        }),
      ]));
      expect(mockVaultRepository.delete).toHaveBeenCalledTimes(1);
    });

    it('returns 412 when the optional ifMatch version is stale', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'immunization-mistake',
        audit: { creatorDid },
        'Immunization.subject': subjectDid,
        'Immunization.meta.versionId': 'version-current',
      } as any);
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ImmunizationDelete,
        request: {
          method: HttpRequestMethods.Delete,
          url: 'Immunization/immunization-mistake',
          ifMatch: 'W/"version-stale"',
        },
        resource: { resourceType: ResourceTypesFhirR4.Immunization, id: 'immunization-mistake', meta: { claims: {} } },
      }]));
      expect((response.body as any).data[0].response.status).toBe('412');
      expect(mockVaultRepository.delete).not.toHaveBeenCalled();
    });

    it('lets the authenticated creator replace the same clinical resource through PUT', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: EXAMPLE_OBSERVATION_IDENTIFIER, audit: { creatorDid },
        'Observation.subject': subjectDid, 'Observation.meta.versionId': 'version-current',
      } as any);
      const response = await communicationManager.process(buildClinicalBatchJob([{
        request: {
          method: HttpRequestMethods.Put,
          url: `${ResourceTypesFhirR4.Observation}/${EXAMPLE_OBSERVATION_IDENTIFIER}`,
          ifMatch: 'W/"version-current"',
        },
        resource: {
          resourceType: ResourceTypesFhirR4.Observation,
          id: EXAMPLE_OBSERVATION_IDENTIFIER,
          subject: { reference: subjectDid },
          status: ObservationStatuses.Final,
          code: { text: 'Corrected result' },
        },
      }]));
      expect((response.body as any).data[0]).toEqual(expect.objectContaining({
        id: EXAMPLE_OBSERVATION_IDENTIFIER,
        response: expect.objectContaining({ status: String(HttpStatusCodes.Ok) }),
      }));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({ id: EXAMPLE_OBSERVATION_IDENTIFIER, audit: { creatorDid } })],
        expect.any(String),
      );
    });

    it('removes the correlated digital-twin projection when the creator deletes an erroneous record', async () => {
      // Step 1. The operational record has an enabled secondary-use projection and a stable twin alias.
      const twinSubjectDid = 'urn:uuid:7b419936-4999-4a18-b21e-681dc3e6a8c0';
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockImplementation(async (_vaultId: string, id: string, sectionId?: string) => {
        if (id === 'immunization-mistake') return {
          id: 'immunization-mistake',
          audit: { creatorDid },
          'Immunization.subject': subjectDid,
          'Immunization.meta.versionId': 'version-current',
        } as any;
        if (String(sectionId).includes('digitaltwin_secondary_use_status')) return { status: 'enabled' } as any;
        if (String(sectionId).includes('digitaltwin_subject_aliases')) return { twinSubjectId: twinSubjectDid } as any;
        return undefined;
      });
      mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) =>
        String(sectionId).includes('immunizations')
          ? [{
              id: 'research-immunization-mistake',
              audit: { creatorDid, sourceRecordId: 'immunization-mistake' },
              'Immunization.subject': twinSubjectDid,
            }] as any
          : []);

      // Step 2. One creator-authorized delete removes both the operational error and only its correlated projection.
      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ImmunizationDelete,
        request: { method: HttpRequestMethods.Delete, url: 'Immunization/immunization-mistake' },
        resource: { resourceType: ResourceTypesFhirR4.Immunization, id: 'immunization-mistake', meta: { claims: {} } },
      }]));

      expect((response.body as any).data[0].response.status).toBe('204');
      expect(mockVaultRepository.delete).toHaveBeenCalledTimes(2);
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        'animal-care_acme',
        'research-immunization-mistake',
        getSubjectScopedSectionId(twinSubjectDid, 'digitaltwin', 'immunizations'),
      );
    });

    it('keeps create success independent when another entry is forbidden', async () => {
      // Step 1. The delete target belongs to a different authenticated creator.
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.get.mockResolvedValue({
        id: 'allergy-owned-by-other',
        audit: { creatorDid: 'did:web:clinic-a.example:professionals:vet-2' },
        'AllergyIntolerance.subject': subjectDid,
        'AllergyIntolerance.meta.versionId': 'version-current',
      } as any);

      // Step 2. Batch semantics preserve the successful create and report the failed delete separately.
      const response = await communicationManager.process(buildClinicalBatchJob([
        {
          type: GatewayRequestEntryTypes.ObservationCreate,
          request: { method: HttpRequestMethods.Post, url: 'Observation' },
          resource: {
            resourceType: ResourceTypesFhirR4.Observation,
            id: 'observation-new',
            meta: { claims: { 'Observation.subject': subjectDid } },
          },
        },
        {
          type: GatewayRequestEntryTypes.AllergyIntoleranceDelete,
          request: {
            method: HttpRequestMethods.Delete,
            url: 'AllergyIntolerance/allergy-owned-by-other',
            ifMatch: 'W/"version-current"',
          },
          resource: { resourceType: ResourceTypesFhirR4.AllergyIntolerance, id: 'allergy-owned-by-other', meta: { claims: {} } },
        },
      ]));

      expect((response.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'observation-new', response: expect.objectContaining({ status: String(HttpStatusCodes.Created) }) }),
        expect.objectContaining({ id: 'allergy-owned-by-other', response: expect.objectContaining({ status: '403' }) }),
      ]));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({ id: 'observation-new', audit: { creatorDid } })],
        expect.any(String),
      );
      expect(mockVaultRepository.delete).not.toHaveBeenCalled();
    });

    it('uses an explicit registered document author for a section-scoped create', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      await mockVaultRepository.put('animal-care_acme', [{
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        role: 'ISCO-08|2250',
        actorDids: [EXAMPLE_PROFESSIONAL_DID],
      } as any, {
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_CLIENT_INSTANCE_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        role: HealthcareActorRoles.VeterinaryTechnicianOrAssistant,
        actorDids: [creatorDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const response = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ObservationCreate,
        request: { method: HttpRequestMethods.Post, url: ResourceTypesFhirR4.Observation },
        resource: {
          resourceType: ResourceTypesFhirR4.Observation,
          id: 'observation-delegated-author',
          subject: { reference: subjectDid },
          status: 'final',
          code: { text: 'Reviewed result' },
        },
      }], EXAMPLE_PROFESSIONAL_DID));

      expect((response.body as any).data[0].response.status).toBe(String(HttpStatusCodes.Created));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        'animal-care_acme',
        [expect.objectContaining({
          id: 'observation-delegated-author',
          'Composition.author': EXAMPLE_PROFESSIONAL_DID,
          audit: { creatorDid: EXAMPLE_PROFESSIONAL_DID, submitterDid: creatorDid },
        })],
        expect.any(String),
      );

      const delegatedUpdate = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ObservationEdit,
        request: {
          method: HttpRequestMethods.Put,
          url: `${ResourceTypesFhirR4.Observation}/observation-delegated-author`,
        },
        resource: {
          resourceType: ResourceTypesFhirR4.Observation,
          id: 'observation-delegated-author',
          subject: { reference: subjectDid },
          status: ObservationStatuses.Final,
          code: { text: 'Changed by submitter' },
        },
      }], EXAMPLE_PROFESSIONAL_DID));
      expect((delegatedUpdate.body as any).data[0].response.status).toBe('403');

      const delegatedDelete = await communicationManager.process(buildClinicalBatchJob([{
        type: GatewayRequestEntryTypes.ObservationDelete,
        request: {
          method: HttpRequestMethods.Delete,
          url: `${ResourceTypesFhirR4.Observation}/observation-delegated-author`,
        },
      }], EXAMPLE_PROFESSIONAL_DID));
      expect((delegatedDelete.body as any).data[0].response.status).toBe('403');
      expect(await mockVaultRepository.get(
        'animal-care_acme',
        'observation-delegated-author',
        getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      )).toBeDefined();
    });
  });

  describe('convertFhirToCommMsg', () => {
    it('should correctly convert a FHIR Communication resource to a CommMsgExtended object', () => {
      const fhirResource = { ...testCommunicationAppointmentFhirR4, resourceType: ResourceTypesFhirR4.Communication };
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
        expect(referenceItem.resource?.meta?.claims?.[CommunicationClaim.NoteText]).toEqual(testAppointmentRequestText);
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
        expect(attachmentItem.resource?.meta?.claims?.[CommunicationClaim.NoteText]).toEqual(testAppointmentRequestText);
        expect(typeof attachmentItem.id).toBe('string');
      }
    });

    it('distributes note texts across payload entries when counts match', () => {
      const fhirResource = {
        resourceType: ResourceTypesFhirR4.Communication,
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
      expect(result.body.data[0].resource?.meta?.claims?.[CommunicationClaim.NoteText]).toBe('first note');
      expect(result.body.data[1].resource?.meta?.claims?.[CommunicationClaim.NoteText]).toBe('second note');
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
              request: { method: HttpRequestMethods.Post, url: 'individual/org.hl7.fhir.api/Communication' },
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
        resourceType: ResourceTypesFhirR4.Communication,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [
            {
              type: ResourceTypesFhirR4.Communication,
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
              request: { method: HttpRequestMethods.Post, url: 'individual/org.hl7.fhir.api/Communication' },
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
        resourceType: ResourceTypesFhirR4.Communication,
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
      ['application/fhir+json', Buffer.from(JSON.stringify({ resourceType: ResourceTypesFhirR4.Observation, status: 'final' }), 'utf8').toString('base64')],
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      const readCanonicalClaim = (claim: string) =>
        record[claim] || record[`${Format.FHIR_API}.${claim}`];
      expect(record['@context']).toBe(Format.FHIR_API);
      expect(readCanonicalClaim(DocumentReferenceClaim.Subject)).toBe(subjectDid);
      expect(record[`${Format.FHIR_R4}.${DocumentReferenceClaim.Subject}`]).toBeUndefined();
      expect(readCanonicalClaim(DocumentReferenceClaim.ContentType)).toBe(contentType);
      expect(String(readCanonicalClaim(DocumentReferenceClaim.Identifier)).startsWith('urn:uuid:')).toBe(true);
      expect(String(readCanonicalClaim(DocumentReferenceClaim.ContentHash)).startsWith('z')).toBe(true);
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.DocumentReference,
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
              data: Buffer.from(JSON.stringify({ resourceType: ResourceTypesFhirR4.Bundle, type: 'document', entry: [] }), 'utf8').toString('base64'),
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-17T10:00:00Z',
                },
              },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: decoded,
      };

      await communicationManager.process(job);

      const tenantVaultId = 'health-care_acme';
      const docRefSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'document-references');
      const putCalls = mockVaultRepository.put.mock.calls.filter((args) => args[0] === tenantVaultId && args[2] === docRefSectionId);
      expect(putCalls.length).toBeGreaterThan(0);
      const record = (putCalls[0][1] as any[])[0];
      expect(record['DocumentReference.subject'] || record['org.hl7.fhir.api.DocumentReference.subject']).toBe(subjectDid);
      expect(record['DocumentReference.identifier'] || record['org.hl7.fhir.api.DocumentReference.identifier']).toBe('urn:uuid:docref-ips-001');
      expect(record['DocumentReference.description'] || record['org.hl7.fhir.api.DocumentReference.description']).toBe('IPS Medication Summary');
      expect(record['DocumentReference.contenttype'] || record['org.hl7.fhir.api.DocumentReference.contenttype']).toBe('application/fhir+json');
    });
  });

  describe('process (FHIR Bundle resource projections)', () => {
    const subjectDid = 'did:web:api.acme.org:individual:bundle-subject-001';

    it('deletes only a version-matched clinical resource authored by the same linked controller identity', async () => {
      // Flow contract:
      // 1. A DCR-authenticated controller creates one allergy; the resource
      //    persists only that session's creator DID while its client alias is
      //    attached to the pre-imported stable assignment.
      // 2. An email-DID session already linked to that assignment deletes the
      //    exact resource version through a different authentication channel.
      // 3. The same batch creates a different allergy and returns per-entry 204.
      // 4. A stale version fails 412 and an unrelated professional fails 403.
      // Authorization invariant: subject and linked verified creator must match.
      // Persistence invariant: no email, phone or stable hash enters the resource.
      const controllerDid = 'did:web:api.acme.org:individual:controller-delete-001';
      const linkedEmailDid = 'did:web:api.acme.org:individual:controller-delete-email-001';
      const controllerPhone = '+34600111222';
      const controllerEmail = 'controller.delete@example.org';
      const allergyId = 'allergy-controller-delete-001';
      const mixedCreateId = 'allergy-controller-mixed-create-001';
      const partialSuccessCreateId = 'allergy-partial-success-create-001';
      const section = 'LOINC|48765-2';
      const tenantVaultId = 'health-care_acme';
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      await mockVaultRepository.put(tenantVaultId, [{
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: subjectDid,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [controllerDid, linkedEmailDid],
      } as any], getClinicalCreatorBindingsSectionId());
      mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
        [...storedRecords.entries()]
          .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
          .map(([, value]) => value));

      const buildJob = (
        attachedBundle: Record<string, any>,
        issuer: string,
        thid: string,
        bearerPayload?: Record<string, any>,
      ): JobRequest => ({
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: 'es',
        sector: 'health-care',
        section: 'individual',
        format: 'org.hl7.fhir.r4' as any,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid,
          iss: issuer,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.r4.Bundle',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: 'batch',
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                subject: { reference: subjectDid },
                topic: { coding: [{ system: 'http://loinc.org', code: '48765-2' }] },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    data: Buffer.from(JSON.stringify(attachedBundle), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
          ...(bearerPayload ? { meta: { bearer: { jwt: { payload: bearerPayload } } } } : {}),
        } as IDecodedDidcommPayload,
      });

      // Step 1. The individual controller authors one clinical resource.
      await communicationManager.process(buildJob({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [{
          request: { method: HttpRequestMethods.Post, url: 'AllergyIntolerance' },
          resource: {
            resourceType: ResourceTypesFhirR4.AllergyIntolerance,
            id: allergyId,
            identifier: [{ value: `urn:uuid:${allergyId}` }],
            patient: { reference: subjectDid },
          },
        }],
      }, controllerDid, 'clinical-create-before-delete-001', {
        sub: 'device-login-account-001',
        azp: EXAMPLE_CLIENT_INSTANCE_UUID,
      }));

      const allergySectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'allergies');
      const stored = await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId) as any;
      expect(stored?.['Composition.author']).toBe(controllerDid);
      expect(Object.keys(stored || {}).some((key) => /email|phone|contact/i.test(key))).toBe(false);
      expect(JSON.stringify(stored)).not.toContain(controllerPhone);
      expect(JSON.stringify(stored)).not.toContain(controllerEmail);
      const creatorBinding = await mockVaultRepository.get(
        tenantVaultId,
        `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        getClinicalCreatorBindingsSectionId(),
      ) as any;
      expect(creatorBinding.dcrClientIds).toContain(EXAMPLE_CLIENT_INSTANCE_UUID);
      const versionId = stored?.['AllergyIntolerance.meta.versionId'];
      expect(versionId).toBeTruthy();

      // Step 2. The same authenticated controller deletes exactly that version.
      const deleteResult = await communicationManager.process(buildJob({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [
          {
            request: { method: HttpRequestMethods.Post, url: 'AllergyIntolerance' },
            resource: {
              resourceType: ResourceTypesFhirR4.AllergyIntolerance,
              id: mixedCreateId,
              identifier: [{ value: `urn:uuid:${mixedCreateId}` }],
              patient: { reference: subjectDid },
            },
          },
          {
            request: {
              method: HttpRequestMethods.Delete,
              url: `AllergyIntolerance/${allergyId}`,
              ifMatch: `W/"${versionId}"`,
            },
          },
        ],
      }, linkedEmailDid, 'clinical-delete-001', {
        sub: 'email-login-account-002',
        email: controllerEmail,
        email_verified: true,
      }));

      // Step 3. The fact is absent and the per-entry batch result is 204.
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(tenantVaultId, allergyId, allergySectionId);
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeUndefined();
      expect(await mockVaultRepository.get(tenantVaultId, mixedCreateId, allergySectionId)).toBeDefined();
      expect((deleteResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: allergyId,
          response: { status: String(HttpStatusCodes.NoContent) },
        }),
      ]));

      // Step 4. A different actor cannot delete a controller-authored resource.
      await communicationManager.process(buildJob({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [{
          request: { method: HttpRequestMethods.Post, url: 'AllergyIntolerance' },
          resource: {
            resourceType: ResourceTypesFhirR4.AllergyIntolerance,
            id: allergyId,
            identifier: [{ value: `urn:uuid:${allergyId}` }],
            patient: { reference: subjectDid },
          },
        }],
      }, linkedEmailDid, 'clinical-recreate-before-forbidden-delete-001', {
        sub: 'email-login-account-002',
        email: controllerEmail,
        email_verified: true,
        phone_number: controllerPhone,
      }));
      const recreated = await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId) as any;
      const staleResult = await communicationManager.process(buildJob({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [{
          request: {
            method: HttpRequestMethods.Delete,
            url: `AllergyIntolerance/${allergyId}`,
            ifMatch: 'W/"stale-version"',
          },
        }],
      }, controllerDid, 'clinical-delete-stale-version-001', {
        sub: 'phone-login-account-001',
        phone_number: controllerPhone,
      }));
      expect((staleResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({ response: expect.objectContaining({ status: '412' }) }),
      ]));
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeDefined();

      const forbiddenResult = await communicationManager.process(buildJob({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [
          {
            request: { method: HttpRequestMethods.Post, url: 'AllergyIntolerance' },
            resource: {
              resourceType: ResourceTypesFhirR4.AllergyIntolerance,
              id: partialSuccessCreateId,
              identifier: [{ value: `urn:uuid:${partialSuccessCreateId}` }],
              patient: { reference: subjectDid },
            },
          },
          {
            request: {
              method: HttpRequestMethods.Delete,
              url: `AllergyIntolerance/${allergyId}`,
              ifMatch: recreated['AllergyIntolerance.meta.versionId'],
            },
          },
        ],
      }, 'did:web:api.acme.org:employee:professional-001', 'clinical-delete-forbidden-001', {
        sub: 'different-professional-account-001',
        email: 'different.professional@example.org',
        email_verified: true,
      }));
      expect((forbiddenResult.body as any).data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: partialSuccessCreateId,
          response: expect.objectContaining({ status: String(HttpStatusCodes.Created) }),
        }),
        expect.objectContaining({ response: expect.objectContaining({ status: '403' }) }),
      ]));
      expect(await mockVaultRepository.get(tenantVaultId, partialSuccessCreateId, allergySectionId)).toBeDefined();
      expect(await mockVaultRepository.get(tenantVaultId, allergyId, allergySectionId)).toBeDefined();
    });

    it('allows only the author to mutate clinical data, except for a later document from the same author organization', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);
      const allergyId = EXAMPLE_ALLERGY_IDENTIFIER.split(':').at(-1)!;
      const tenantId = EXAMPLE_PROVIDER_ORGANIZATION_DID.split(':').at(-1)!;
      const bearerPayload = { sub: EXAMPLE_PROFESSIONAL_DID };
      const buildJob = (
        attachment: Record<string, any>,
        authenticatedIdentity: Record<string, any> = bearerPayload,
      ): JobRequest => ({
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId,
        jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION,
        sector: Sector.HEALTH_CARE,
        section: 'individual',
        format: Format.FHIR_R4,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: randomUUID(),
          iss: EXAMPLE_PROVIDER_ORGANIZATION_DID,
          aud: testServerDid,
          type: ResourceTypesFhirR4.Bundle,
          meta: { bearer: { jwt: { payload: authenticatedIdentity } } },
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: BundleTypes.batch,
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                status: 'completed',
                subject: { reference: EXAMPLE_SUBJECT_DID },
                topic: { text: EXAMPLE_CLINICAL_SECTION_ALLERGIES },
                payload: [{ contentAttachment: {
                  contentType: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
                  data: Buffer.from(JSON.stringify(attachment), 'utf8').toString('base64'),
                } }],
              },
            }],
          },
        } as IDecodedDidcommPayload,
      });
      const clinicalDocument = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.document,
        entry: [{ resource: {
          resourceType: ResourceTypesFhirR4.Composition,
          id: EXAMPLE_IPS_COMPOSITION_IDENTIFIER,
          status: 'final',
          subject: { reference: EXAMPLE_SUBJECT_DID },
          author: [{ reference: EXAMPLE_PROFESSIONAL_DID }],
          section: [{
            code: { text: EXAMPLE_CLINICAL_SECTION_ALLERGIES },
            entry: [{ reference: `${ResourceTypesFhirR4.AllergyIntolerance}/${allergyId}` }],
          }],
        } }, { resource: {
          resourceType: ResourceTypesFhirR4.AllergyIntolerance,
          id: allergyId,
          identifier: [{ value: EXAMPLE_ALLERGY_IDENTIFIER }],
          patient: { reference: EXAMPLE_SUBJECT_DID },
        } }],
      };

      // Direct clinical-write contract: the submitted author is the same
      // operational actor DID authenticated by the envelope, never a stable
      // multibase URN or portal alias. The provider tenant remains the route target.
      await communicationManager.process(buildJob(clinicalDocument));
      const tenantVaultId = `${Sector.HEALTH_CARE}_${tenantId}`;
      const sectionId = getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'allergies');
      const stored = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(stored?.['Composition.author']).toBe(EXAMPLE_PROFESSIONAL_DID);

      const changedDocument = structuredClone(clinicalDocument);
      (changedDocument.entry[1].resource as any).onsetDateTime = EXAMPLE_ALLERGY_ONSET_DATE_TIME;
      await communicationManager.process(buildJob(changedDocument, { sub: EXAMPLE_CONTROLLER_DID }));
      const afterForbiddenUpdate = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        afterForbiddenUpdate?.['AllergyIntolerance.onset-datetime']
        || afterForbiddenUpdate?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBeUndefined();

      await communicationManager.process(buildJob(changedDocument));
      const afterAuthorUpdate = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        afterAuthorUpdate?.['AllergyIntolerance.onset-datetime']
        || afterAuthorUpdate?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBe(EXAMPLE_ALLERGY_ONSET_DATE_TIME);

      const deleteBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleTypes.batch,
        entry: [{ request: {
          method: HttpRequestMethods.Delete,
          url: `${ResourceTypesFhirR4.AllergyIntolerance}/${allergyId}`,
        } }],
      };
      const otherActorDeletion = await communicationManager.process(buildJob(deleteBundle, {
        sub: EXAMPLE_CONTROLLER_DID,
      }));
      expect((otherActorDeletion.body as any).data[0].response.status).toBe('403');
      const verifiedDeletion = await communicationManager.process(buildJob(deleteBundle));
      expect((verifiedDeletion.body as any).data[0].response.status).toBe('204');

      const externallyAuthoredDocument = structuredClone(clinicalDocument);
      // A document-author Organization is resolved from the IPS graph; the
      // importing employee remains only the submitter.
      (externallyAuthoredDocument.entry[0].resource as any).author = [{
        reference: EXAMPLE_PROVIDER_ORGANIZATION_DID,
      }];
      (externallyAuthoredDocument.entry[0].resource as any).date = '2026-09-01T10:00:00.000Z';
      externallyAuthoredDocument.entry.push({
        fullUrl: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        resource: {
          resourceType: ResourceTypesFhirR4.Organization,
          id: EXAMPLE_KYC_CONTROLLER_UUID,
        },
      } as any);
      await communicationManager.process(buildJob(externallyAuthoredDocument));
      const externallyAuthoredRecord = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(externallyAuthoredRecord?.['Composition.author']).toBe(EXAMPLE_PROVIDER_ORGANIZATION_DID);
      expect(externallyAuthoredRecord?.audit).toEqual(expect.objectContaining({
        creatorDid: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        submitterDid: EXAMPLE_PROFESSIONAL_DID,
        authorOwnerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        documentDate: '2026-09-01T10:00:00.000Z',
      }));

      const forbiddenExternalOverwrite = structuredClone(externallyAuthoredDocument);
      (forbiddenExternalOverwrite.entry[1].resource as any).onsetDateTime = EXAMPLE_ALLERGY_ONSET_DATE_TIME;
      await communicationManager.process(buildJob(forbiddenExternalOverwrite));
      const unchangedExternalRecord = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        unchangedExternalRecord?.['AllergyIntolerance.onset-datetime']
        || unchangedExternalRecord?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBeUndefined();

      const laterSameOrganizationDocument = structuredClone(forbiddenExternalOverwrite);
      (laterSameOrganizationDocument.entry[0].resource as any).date = '2026-09-01T10:01:00.000Z';
      await communicationManager.process(buildJob(laterSameOrganizationDocument));
      const replacedByOrganization = await mockVaultRepository.get(tenantVaultId, allergyId, sectionId) as any;
      expect(
        replacedByOrganization?.['AllergyIntolerance.onset-datetime']
        || replacedByOrganization?.['org.hl7.fhir.api.AllergyIntolerance.onset-datetime'],
      ).toBe(EXAMPLE_ALLERGY_ONSET_DATE_TIME);

      const forbiddenExternalDeletion = await communicationManager.process(buildJob(deleteBundle));
      expect((forbiddenExternalDeletion.body as any).data[0].response.status).toBe('403');
    });

    it('normalizes a native EHR section update without meta.claims and never invents a medication section', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const section = 'LOINC|48765-2';
      const sectionBatch = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        data: [{
          type: GatewayRequestEntryTypes.AllergyIntoleranceEdit,
          resource: {
            resourceType: ResourceTypesFhirR4.AllergyIntolerance,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [{
            type: ResourceTypesFhirR4.Communication,
            resource: {
              resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
      expect(compositionRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({ '@context': Format.FHIR_API }),
      ]));
      expect(compositionRecords.some((record) =>
        Object.keys(record).some((key) => key.startsWith(`${Format.FHIR_R4}.Composition.`)))).toBe(false);
    });

    it('rejects an unscoped clinical batch instead of accepting an update that reads back empty', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const unscopedBatch = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        data: [{
          type: GatewayRequestEntryTypes.AllergyIntoleranceEdit,
          resource: {
            resourceType: ResourceTypesFhirR4.AllergyIntolerance,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [{
            type: ResourceTypesFhirR4.Communication,
            meta: { claims: {
              '@context': 'org.hl7.fhir.r4',
              'Communication.subject': subjectDid,
            } },
            resource: {
              resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Composition,
              id: 'ips-composition-001',
              status: 'final',
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            },
          },
          {
            resource: {
              resourceType: ResourceTypesFhirR4.MedicationStatement,
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
              resourceType: ResourceTypesFhirR4.Observation,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
      expect(medicationRecord.audit?.creatorDid).toBe(decoded.iss);
      expect(
        medicationRecord['MedicationStatement.subject']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.subject'],
      ).toBe(subjectDid);
      expect(
        medicationRecord['MedicationStatement.identifier']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.identifier'],
      ).toBe('urn:uuid:medication-001');
      expect(
        medicationRecord['MedicationStatement.code-display']
        || medicationRecord['org.hl7.fhir.api.MedicationStatement.code-display'],
      ).toBe('Paracetamol 500 MG Oral Tablet');
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
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code-display', value: 'Paracetamol 500 MG Oral Tablet' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code-text', value: 'Paracetamol 500mg' }),
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
        observationRecord['Observation.code-display']
        || observationRecord['org.hl7.fhir.api.Observation.code-display'],
      ).toBe('Blood pressure panel with all children optional');
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
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.code-display', value: 'Blood pressure panel with all children optional' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.code-text', value: 'Tension arterial' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.language', value: 'es' }),
          expect.objectContaining({ name: 'org.hl7.fhir.api.Observation.user-selected', value: 'true' }),
        ]),
      );
    });

    it('keeps DocumentReference attachments working as a compatibility wrapper around a document bundle', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const documentBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Composition,
              id: 'ips-composition-embedded-001',
              status: 'final',
              subject: { reference: subjectDid },
              type: { coding: [{ system: 'http://loinc.org', code: '60591-5' }] },
            },
          },
          {
            resource: {
              resourceType: ResourceTypesFhirR4.MedicationStatement,
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
        resourceType: ResourceTypesFhirR4.DocumentReference,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
      mockVaultRepository.get.mockResolvedValue({ status: 'enabled' } as any);

      const documentBundle = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Composition,
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
              resourceType: ResourceTypesFhirR4.MedicationStatement,
              id: 'medication-sections-001',
              status: 'active',
              subject: { reference: subjectDid },
              medicationCodeableConcept: { text: 'Paracetamol 500mg' },
              identifier: [{ value: 'urn:uuid:medication-sections-001' }],
            },
          },
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Observation,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: 'thread-composition-sections-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:receiver.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'org.hl7.fhir.r4.Bundle',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
            type: 'batch',
            data: [
              {
                type: ResourceTypesFhirR4.Communication,
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
                  resourceType: ResourceTypesFhirR4.Communication,
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
      const aliasPut = mockVaultRepository.put.mock.calls.find((args) =>
        String(args[2] || '').includes('digitaltwin_subject_aliases'));
      const twinSubjectId = (aliasPut?.[1] as any[])?.[0]?.twinSubjectId;
      const digitalTwinCompositionSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition');
      const compositionPuts = mockVaultRepository.put.mock.calls.filter(
        (args) =>
          args[0] === tenantVaultId
          && (args[2] === individualCompositionSectionId || args[2] === digitalTwinCompositionSectionId),
      );

      expect(compositionPuts).toHaveLength(2);
      const projectedSections = compositionPuts.flatMap((args) =>
        ((args[1] as any[]) || []).map((record) =>
          record['Composition.section'] || record['org.hl7.fhir.r4.Composition.section'],
        ),
      );
      expect(projectedSections).toEqual([
        'LOINC|10160-0,LOINC|8716-3',
        'LOINC|10160-0,LOINC|8716-3',
      ]);
      const researchRecords = compositionPuts
        .filter((args) => args[2] === digitalTwinCompositionSectionId)
        .flatMap((args) => (args[1] as any[]) || []);
      expect(researchRecords).toHaveLength(1);
      for (const record of researchRecords) {
        const subjectKey = Object.keys(record).find((key) => key.endsWith('Composition.subject'));
        expect(record[subjectKey as string]).toBe(twinSubjectId);
        expect(JSON.stringify(record)).not.toContain(subjectDid);
      }
    });

    it('does not project duplicate clinical resources when the replayed IPS changes container ids, dates, and narrative text', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const buildDocumentBundle = (suffix: string, compositionDate: string) => ({
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Composition,
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
              resourceType: ResourceTypesFhirR4.MedicationStatement,
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
              resourceType: ResourceTypesFhirR4.Observation,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: ResourceTypesFhirR4.Composition,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-22T10:00:00Z',
                },
              },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
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
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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

    it('keeps a draft Consent Bundle in the Communication inbox without creating an active rule', async () => {
      mockTenantsCacheManager.getTenantDid.mockResolvedValue(testServerDid as any);
      mockVaultRepository.vaultExists.mockResolvedValue(true as any);

      const permissionBundleEditor = new BundleEditor()
        .setBundleOperation(BundleOperations.create)
        .setBundleType(BundleTypes.batch)
        .setAllowedResourceType(BundleEditableResourceTypes.consent);
      permissionBundleEditor.newEntryAs(BundleEditableResourceTypes.consent)
        .setIdentifier(EXAMPLE_CONSENT_IDENTIFIER)
        .setStatus(ConsentStatuses.Draft)
        .setSubject(EXAMPLE_SUBJECT_DID)
        .setDecision(ConsentDecisions.Permit)
        .doneEntry();
      const permissionBundle = permissionBundleEditor.buildJsonApi();

      const communicationClaims = {
        '@context': Format.FHIR_API,
        [CommunicationClaim.Identifier]: EXAMPLE_COMMUNICATION_IDENTIFIER,
        [CommunicationClaim.Subject]: EXAMPLE_SUBJECT_DID,
        [CommunicationClaim.Sender]: EXAMPLE_PROFESSIONAL_DID,
        [CommunicationClaim.Recipient]: EXAMPLE_SUBJECT_DID,
        [CommunicationClaim.ContentAttachmentType]: EXAMPLE_CONTENT_TYPE_FHIR_JSON,
        [CommunicationClaim.ContentAttachmentData]: Buffer.from(
          JSON.stringify(permissionBundle),
          'utf8',
        ).toString('base64'),
      };
      const job: JobRequest = {
        id: randomUUID(),
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        tenantId: 'acme',
        jurisdiction: EXAMPLE_HEALTHCARE_JURISDICTION,
        sector: Sector.HEALTH_CARE,
        section: 'individual',
        format: Format.FHIR_API as any,
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: EXAMPLE_COMMUNICATION_IDENTIFIER,
          iss: EXAMPLE_PROFESSIONAL_DID,
          aud: testServerDid,
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            data: [{
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
                meta: { claims: communicationClaims },
              },
            }],
          },
        } as any,
      };

      const response = await communicationManager.process(job);

      expect((response.body as any).data[0]?.response?.status).toBe('200');
      const writtenSectionIds = mockVaultRepository.put.mock.calls.map((call) => String(call[2] || ''));
      expect(writtenSectionIds.some((sectionId) => sectionId.endsWith('_rules'))).toBe(false);
      expect(writtenSectionIds.some((sectionId) => sectionId.endsWith('_consents'))).toBe(false);
      expect(writtenSectionIds.some((sectionId) => sectionId.includes('communications'))).toBe(true);
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          data: [
            {
              type: GatewayResponseEntryTypes.BundleSearch,
              response: { status: String(HttpStatusCodes.Ok) },
              resource: {
                resourceType: ResourceTypesFhirR4.Bundle,
                type: 'document',
                entry: [{ resource: { resourceType: ResourceTypesFhirR4.Composition } }],
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.r4',
                  'Communication.identifier': 'comm-ips-search-001',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-06-02T10:00:00Z',
                },
              },
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe(GatewayResponseEntryTypes.BundleSearch);
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          data: [
            {
              type: GatewayResponseEntryTypes.BundleSummary,
              response: { status: String(HttpStatusCodes.Ok) },
              resource: {
                resourceType: ResourceTypesFhirR4.Bundle,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      // The test calls CommunicationManager only. A portal/BFF must never copy
      // the forwarded job below into a direct Subject/$summary HTTP request.
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe(GatewayResponseEntryTypes.BundleSummary);
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          data: [{
            type: GatewayResponseEntryTypes.BundleSummary,
            response: { status: String(HttpStatusCodes.Ok) },
            resource: {
              resourceType: ResourceTypesFhirR4.Bundle,
              type: 'document',
              meta: { forwardedBody: (forwardedJob.content as any)?.body },
            },
          }],
        },
        }) as any;
      });

      const parameters = {
        resourceType: ResourceTypesFhirR4.Parameters,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [{
            type: ResourceTypesFhirR4.Communication,
            resource: {
              resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          data: [
            {
              type: GatewayResponseEntryTypes.BundleSummary,
              response: { status: String(HttpStatusCodes.Ok) },
              resource: {
                resourceType: ResourceTypesFhirR4.Bundle,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch-response',
          data: [
            {
              type: GatewayResponseEntryTypes.SubjectSearch,
              response: { status: String(HttpStatusCodes.Ok) },
              resource: {
                resourceType: ResourceTypesFhirR4.Bundle,
                type: 'searchset',
                total: 3,
                data: [{ id: 'consent-1' }, { id: 'consent-2' }, { id: 'consent-3' }],
              },
            },
          ],
        },
      } as any);

      const parametersResource = {
        resourceType: ResourceTypesFhirR4.Parameters,
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
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              type: ResourceTypesFhirR4.Communication,
              resource: {
                resourceType: ResourceTypesFhirR4.Communication,
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: decoded,
      };

      const response = await communicationManager.process(job);
      const data = (response.body as any)?.data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0]?.type).toBe(GatewayResponseEntryTypes.SubjectSearch);
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
      const searchProjection = buildExampleCommunicationParticipantProjection();

      const fhirResource = {
        resourceType: ResourceTypesFhirR4.Communication,
        status: 'completed',
        subject: { reference: 'did:web:subject.example' },
        sender: { reference: 'mailto:Sender@Example.org' },
        recipient: [
          { reference: 'did:web:member.example' },
          { reference: '+34 600 111 222' },
        ],
        sent: '2026-06-15T10:00:00Z',
        meta: { claims: {
          [CommunicationClaim.Category]: searchProjection.category,
          [CommunicationClaim.Topic]: searchProjection.topic,
        } },
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
        resourceType: ResourceTypesFhirR4.Communication,
        action: '_batch',
        content: {
          jti: randomUUID(),
          thid: 'thread-participant-index-001',
          iss: 'did:web:sender.example',
          aud: 'did:web:gw.example',
          exp: Math.floor(Date.now() / 1000) + 300,
          type: 'api+json',
          body: {
            resourceType: ResourceTypesFhirR4.Bundle,
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
      expect(storedRecord[CommunicationClaim.Category]).toBe(searchProjection.category);
      expect(storedRecord[CommunicationClaim.Topic]).toBe(searchProjection.topic);
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
              type: DidcommPayloadTypes.ExtendedCommunicationMessage,
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
          type: DidcommPayloadTypes.ExtendedCommunicationMessage,
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
        resourceType: ResourceTypesFhirR4.Communication,
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
      expect(data[0].resource.meta.claims['@context']).toBe(Format.FHIR_API);
      expect(Object.keys(data[0].resource.meta.claims).some((key) =>
        key.startsWith(`${Format.FHIR_R4}.Communication.`))).toBe(false);
      expect(data[0].resource.meta.claims[CommunicationClaim.Identifier]).toBe('comm-1');
    });
  });
});
