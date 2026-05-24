import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  HealthcareActorRoles,
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from '../../shared/healthcare-constants';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getIndividualSectionId, getSubjectScopedSectionId } from '../../utils/individual-sections';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { getClaimValue } from '../../utils/claims';

describe('Consent via Communication API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('ingests one or more Consent resources via Communication and persists rules, attachments, and consent projections', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
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
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims as any);
      const tenantClaims = testPayloadCreateTenant1.body.data[0].meta.claims as any;
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims[ClaimsOrganizationSchemaorg.alternateName],
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);
      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subjectDid = 'did:web:api.acme.org:individual:subject-consent-001';
      const attachment1 = Buffer.from(JSON.stringify({ agreement: 'permit treatment 1' }), 'utf8').toString('base64');
      const attachment2 = Buffer.from(JSON.stringify({ agreement: 'permit treatment 2' }), 'utf8').toString('base64');

      const makeConsentResource = (identifier: string, actor: string, attachmentData: string) => ({
        resourceType: 'Consent',
        status: 'active',
        meta: {
          claims: {
            '@context': 'org.hl7.fhir.api',
            [ClaimConsent.decision]: 'permit',
            [ClaimConsent.subject]: subjectDid,
            [ClaimConsent.identifier]: identifier,
            [ClaimConsent.grantee]: actor,
            [ClaimConsent.date]: '2026-05-22',
            [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
            [ClaimConsent.action]: HealthcareConsentActions.AllergiesAndIntolerances,
            [ClaimConsent.actorIdentifier]: actor,
            [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
            [ClaimConsent.attachmentContentType]: 'application/odrl+json',
            [ClaimConsent.attachmentData]: attachmentData,
          },
        },
      });

      const consent1 = makeConsentResource('urn:uuid:patient-consent-001', 'did:web:hospital.example.com', attachment1);
      const consent2 = makeConsentResource('urn:uuid:patient-consent-002', 'did:web:clinic.example.com', attachment2);

      const thidBatch = 'communication-consent-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidBatch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
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
                  sent: '2026-05-22T10:00:00Z',
                  note: [
                    { text: 'Consent 1 note' },
                    { text: 'Consent 2 note' },
                  ],
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'consent-001.json',
                        data: Buffer.from(JSON.stringify(consent1), 'utf8').toString('base64'),
                      },
                    },
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'consent-002.json',
                        data: Buffer.from(JSON.stringify(consent2), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(submitResp.status).toBe(202);

      let batchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response',
          headers: { 'content-type': 'application/json' },
          body: { thid: thidBatch },
        });
        if (pollResp.status === 200) {
          batchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(batchPayload?.resourceType).toBe('Bundle');
      expect(batchPayload?.data?.[0]?.response?.status).toBe('200');

      const attachments = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getIndividualSectionId(subjectDid, 'attachments'),
      );
      const rules = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getIndividualSectionId(subjectDid, 'rules'),
      );
      const consents = await vaultRepository.getContainersInSection(
        tenantVaultId,
        getSubjectScopedSectionId(subjectDid, 'individual', 'consents'),
      );

      expect(attachments).toHaveLength(2);
      expect(rules).toHaveLength(2);
      expect(consents).toHaveLength(2);
      expect(rules.map((rule: any) => getClaimValue(rule, ClaimConsent.identifier)).sort()).toEqual([
        'urn:uuid:patient-consent-001',
        'urn:uuid:patient-consent-002',
      ]);
      expect(rules.every((rule: any) => !getClaimValue(rule, ClaimConsent.attachmentData))).toBe(true);
      expect(consents.map((consent: any) => getClaimValue(consent, ClaimConsent.identifier)).sort()).toEqual([
        'urn:uuid:patient-consent-001',
        'urn:uuid:patient-consent-002',
      ]);
    } finally {
      queueAdapter.stop();
    }
  });
});
