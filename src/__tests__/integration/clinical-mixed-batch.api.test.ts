// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Flow contract journey: 1) bootstrap one tenant and authenticated clinical
 * Communication route; 2) create one subject-scoped Immunization through an
 * attached Bundle.type=batch; 3) prove a stale optional If-Match returns 412
 * without deleting it; 4) delete the same technical resource.id without
 * If-Match; 5) prove the authoritative vault no longer contains the record;
 * 6) register two member creator bindings; 7) create individual-authored
 * content with one member as personal attester; 8) let the other member
 * correct it; 9) deny member deletion because neither is the author.
 * Authorization invariant: the verified route/DIDComm issuer is recorded as
 * creator and only that same creator may delete. Persistence invariant: every
 * inner batch entry has an independent terminal response and DELETE never
 * treats a business identifier as the technical FHIR id.
 */
import { GatewayRequestEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import {
  CompositionAttesterModes,
  CompositionClaim,
  FhirIpsCreatorKinds,
} from 'gdc-common-utils-ts';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { testTenant1TenantId } from '../data/organization.data';
import {
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_CLIENT_INSTANCE_UUID,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_RELATED_PERSON_MEMBER_DID,
  EXAMPLE_RELATED_PERSON_ROLE,
} from 'gdc-common-utils-ts/examples/shared';
import { getClinicalCreatorBindingsSectionId } from '../../utils/ips-bundle';

describe('clinical mixed batch API (integration)', () => {
  afterEach(() => resetServerConfig());

  it('deletes by technical id without If-Match and enforces a supplied stale version', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.HOST_COVERAGE_SCOPE = 'EU';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostCollectionName = generateTenantCollectionNameFromClaims({
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      } as any);
      const tenantClaims = testPayloadCreateTenant1.body.data[0].resource.meta.claims as any;
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);
      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
          didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
        },
      } as any, 'host');
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:mixed-batch-001';
      const resourceId = 'immunization-mistake';
      const sectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'immunizations');

      const submit = async (
        thid: string,
        innerEntry: Record<string, unknown>,
        provenanceClaims?: Record<string, unknown>,
        actorDid: string = EXAMPLE_RELATED_PERSON_MEMBER_DID,
      ) => {
        const attachment = Buffer.from(JSON.stringify({
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          ...(provenanceClaims ? { meta: { claims: provenanceClaims } } : {}),
          entry: [innerEntry],
        }), 'utf8').toString('base64');
        const claims = {
          '@context': 'org.hl7.fhir.r4',
          [CommunicationClaim.Identifier]: `urn:uuid:${thid}`,
          [CommunicationClaim.Subject]: subjectDid,
          [CommunicationClaim.Sender]: actorDid,
          [CommunicationClaim.Topic]: HealthcareBasicSections.Immunizations.attributeValue,
          [CommunicationClaim.ContentAttachmentType]: 'application/fhir+json',
          [CommunicationClaim.ContentAttachmentData]: attachment,
        };
        const response = await invokeExpress(app, {
          method: HttpRequestMethods.Post,
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            jti: `jti-${thid}`,
            iss: actorDid,
            aud: 'did:web:api.acme.org',
            type: 'application/didcomm-plain+json',
            thid,
            body: {
              resourceType: ResourceTypesFhirR4.Bundle,
              type: 'batch',
              entry: [{
                request: { method: HttpRequestMethods.Post, url: 'Communication' },
                meta: { claims },
                resource: { resourceType: ResourceTypesFhirR4.Communication, status: 'completed', meta: { claims } },
              }],
            },
          },
        });
        expect(response.status).toBe(202);
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const poll = await invokeExpress(app, {
            method: HttpRequestMethods.Post,
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid },
          });
          if (poll.status === 200) return JSON.parse(poll.text);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`Timed out polling ${thid}`);
      };

      const created = await submit('mixed-batch-create', {
        type: GatewayRequestEntryTypes.ImmunizationCreate,
        request: { method: HttpRequestMethods.Post, url: 'Immunization' },
        resource: {
          resourceType: ResourceTypesFhirR4.Immunization,
          id: resourceId,
          meta: { claims: { 'Immunization.subject': subjectDid, 'Immunization.status': 'completed' } },
        },
      });
      expect(created.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: String(HttpStatusCodes.Created) }) }),
      ]));
      const stored = await vaultRepository.get<any>(tenantVaultId, resourceId, sectionId);
      expect(stored?.audit?.creatorDid).toBeTruthy();

      const stale = await submit('mixed-batch-stale-delete', {
        type: GatewayRequestEntryTypes.ImmunizationDelete,
        request: { method: HttpRequestMethods.Delete, url: `Immunization/${resourceId}`, ifMatch: 'W/"stale"' },
        resource: { resourceType: ResourceTypesFhirR4.Immunization, id: resourceId, meta: { claims: {} } },
      });
      expect(stale.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: '412' }) }),
      ]));
      expect(await vaultRepository.get(tenantVaultId, resourceId, sectionId)).toBeTruthy();

      const deleted = await submit('mixed-batch-delete', {
        type: GatewayRequestEntryTypes.ImmunizationDelete,
        request: { method: HttpRequestMethods.Delete, url: `Immunization/${resourceId}` },
        resource: { resourceType: ResourceTypesFhirR4.Immunization, id: resourceId, meta: { claims: {} } },
      });
      expect(deleted.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: String(HttpStatusCodes.NoContent) }) }),
      ]));
      expect(await vaultRepository.get(tenantVaultId, resourceId, sectionId)).toBeUndefined();

      const memberAuthor = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
      const successorMemberAuthor = `urn:uuid:${EXAMPLE_CLIENT_INSTANCE_UUID}`;
      await vaultRepository.put(tenantVaultId, [{
        id: memberAuthor,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: memberAuthor,
        ownerIdentifier: subjectDid,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [EXAMPLE_RELATED_PERSON_MEMBER_DID],
      } as any, {
        id: successorMemberAuthor,
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: successorMemberAuthor,
        authorIdentifier: successorMemberAuthor,
        ownerIdentifier: subjectDid,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [EXAMPLE_CONTROLLER_DID],
      } as any], getClinicalCreatorBindingsSectionId());
      const subjectAuthoredId = EXAMPLE_OBSERVATION_IDENTIFIER.split(':').at(-1)!;
      const subjectAuthored = await submit('mixed-batch-subject-authored', {
        type: GatewayRequestEntryTypes.ObservationCreate,
        request: { method: HttpRequestMethods.Post, url: ResourceTypesFhirR4.Observation },
        resource: {
          resourceType: ResourceTypesFhirR4.Observation,
          id: subjectAuthoredId,
          subject: { reference: subjectDid },
          status: 'final',
        },
      }, {
        [CompositionClaim.Author]: subjectDid,
        [CompositionClaim.Attester]: memberAuthor,
        [CompositionClaim.AttesterMode]: CompositionAttesterModes.Personal,
      });
      expect(subjectAuthored.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: subjectAuthoredId,
          response: expect.objectContaining({ status: String(HttpStatusCodes.Created) }),
        }),
      ]));
      const observationSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'observations');
      const subjectAuthoredRecord = await vaultRepository.get<any>(
        tenantVaultId,
        subjectAuthoredId,
        observationSectionId,
      );
      expect(subjectAuthoredRecord?.[CompositionClaim.Author]).toBe(subjectDid);
      expect(subjectAuthoredRecord?.[CompositionClaim.Attester]).toBe(memberAuthor);
      const compositionRecords = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(subjectDid, 'individual', 'composition'),
      );
      const subjectComposition = compositionRecords.find(
        (record: any) => record?.[CompositionClaim.Author] === subjectDid,
      );
      expect(subjectComposition?.[CompositionClaim.Attester]).toBe(memberAuthor);
      expect(subjectComposition?.[CompositionClaim.AttesterMode]).toBe(
        CompositionAttesterModes.Personal,
      );

      const correctedByAnotherMember = await submit('mixed-batch-subject-authored-update', {
        type: GatewayRequestEntryTypes.ObservationEdit,
        request: {
          method: HttpRequestMethods.Put,
          url: `${ResourceTypesFhirR4.Observation}/${subjectAuthoredId}`,
        },
        resource: {
          resourceType: ResourceTypesFhirR4.Observation,
          id: subjectAuthoredId,
          subject: { reference: subjectDid },
          status: 'corrected',
        },
      }, {
        [CompositionClaim.Author]: subjectDid,
        [CompositionClaim.Attester]: successorMemberAuthor,
        [CompositionClaim.AttesterMode]: CompositionAttesterModes.Personal,
      }, EXAMPLE_CONTROLLER_DID);
      expect(correctedByAnotherMember.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: subjectAuthoredId,
          response: expect.objectContaining({ status: String(HttpStatusCodes.Ok) }),
        }),
      ]));
      const correctedRecord = await vaultRepository.get<any>(
        tenantVaultId,
        subjectAuthoredId,
        observationSectionId,
      );
      expect(correctedRecord?.[CompositionClaim.Author]).toBe(subjectDid);
      expect(correctedRecord?.[CompositionClaim.Attester]).toBe(successorMemberAuthor);
      expect(correctedRecord?.audit).toEqual(expect.objectContaining({
        creatorDid: subjectDid,
        submitterDid: EXAMPLE_CONTROLLER_DID,
      }));

      const forbiddenMemberDelete = await submit('mixed-batch-subject-authored-delete', {
        type: GatewayRequestEntryTypes.ObservationDelete,
        request: {
          method: HttpRequestMethods.Delete,
          url: `${ResourceTypesFhirR4.Observation}/${subjectAuthoredId}`,
        },
      });
      expect(forbiddenMemberDelete.data).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: subjectAuthoredId,
          response: expect.objectContaining({ status: String(HttpStatusCodes.Forbidden) }),
        }),
      ]));
      expect(await vaultRepository.get(
        tenantVaultId,
        subjectAuthoredId,
        observationSectionId,
      )).toBeDefined();
    } finally {
      queueAdapter.stop();
    }
  });
});
