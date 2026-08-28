/**
 * Flow contract journey: 1) bootstrap one tenant and authenticated clinical
 * Communication route; 2) create one subject-scoped Immunization through an
 * attached Bundle.type=batch; 3) prove a stale optional If-Match returns 412
 * without deleting it; 4) delete the same technical resource.id without
 * If-Match; 5) prove the authoritative vault no longer contains the record.
 * Authorization invariant: the verified route/DIDComm issuer is recorded as
 * creator and only that same creator may delete. Persistence invariant: every
 * inner batch entry has an independent terminal response and DELETE never
 * treats a business identifier as the technical FHIR id.
 */
import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { testTenant1TenantId } from '../data/organization.data';

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
      const tenantClaims = testPayloadCreateTenant1.body.data[0].meta.claims as any;
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

      const submit = async (thid: string, innerEntry: Record<string, unknown>) => {
        const attachment = Buffer.from(JSON.stringify({
          resourceType: 'Bundle',
          type: 'batch',
          entry: [innerEntry],
        }), 'utf8').toString('base64');
        const claims = {
          '@context': 'org.hl7.fhir.r4',
          [CommunicationClaim.Identifier]: `urn:uuid:${thid}`,
          [CommunicationClaim.Subject]: subjectDid,
          [CommunicationClaim.Sender]: 'did:web:api.acme.org:employee:creator',
          [CommunicationClaim.Topic]: HealthcareBasicSections.Immunizations.attributeValue,
          [CommunicationClaim.ContentAttachmentType]: 'application/fhir+json',
          [CommunicationClaim.ContentAttachmentData]: attachment,
        };
        const response = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            jti: `jti-${thid}`,
            iss: 'did:web:api.acme.org:employee:creator',
            aud: 'did:web:api.acme.org',
            type: 'application/didcomm-plain+json',
            thid,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [{
                request: { method: 'POST', url: 'Communication' },
                meta: { claims },
                resource: { resourceType: 'Communication', status: 'completed', meta: { claims } },
              }],
            },
          },
        });
        expect(response.status).toBe(202);
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const poll = await invokeExpress(app, {
            method: 'POST',
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
        type: 'Immunization-create-request-v1.0',
        request: { method: 'POST', url: 'Immunization' },
        resource: {
          resourceType: 'Immunization',
          id: resourceId,
          meta: { claims: { 'Immunization.subject': subjectDid, 'Immunization.status': 'completed' } },
        },
      });
      expect(created.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: '201' }) }),
      ]));
      const stored = await vaultRepository.get<any>(tenantVaultId, resourceId, sectionId);
      expect(stored?.audit?.creatorDid).toBeTruthy();

      const stale = await submit('mixed-batch-stale-delete', {
        type: 'Immunization-delete-request-v1.0',
        request: { method: 'DELETE', url: `Immunization/${resourceId}`, ifMatch: 'W/"stale"' },
        resource: { resourceType: 'Immunization', id: resourceId, meta: { claims: {} } },
      });
      expect(stale.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: '412' }) }),
      ]));
      expect(await vaultRepository.get(tenantVaultId, resourceId, sectionId)).toBeTruthy();

      const deleted = await submit('mixed-batch-delete', {
        type: 'Immunization-delete-request-v1.0',
        request: { method: 'DELETE', url: `Immunization/${resourceId}` },
        resource: { resourceType: 'Immunization', id: resourceId, meta: { claims: {} } },
      });
      expect(deleted.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resourceId, response: expect.objectContaining({ status: '204' }) }),
      ]));
      expect(await vaultRepository.get(tenantVaultId, resourceId, sectionId)).toBeUndefined();
    } finally {
      queueAdapter.stop();
    }
  });
});
