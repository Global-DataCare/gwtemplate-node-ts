import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';

describe('MedicationStatement API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('creates and searches MedicationStatement entries for a tenant individual scope', async () => {
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

      const thidBatch = 'medication-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidBatch,
          body: {
            data: [
              {
                type: 'MedicationStatement',
                request: { method: 'POST' },
                resource: {
                  resourceType: 'MedicationStatement',
                  id: 'medication-001',
                },
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.api',
                    'MedicationStatement.identifier': 'urn:uuid:medication-001',
                    'MedicationStatement.subject': 'Organization/subject-001',
                    'MedicationStatement.medication': 'Paracetamol 500mg',
                    'MedicationStatement.status': 'active',
                    'MedicationStatement.effective-date-time': '2026-05-01T10:00:00Z',
                  },
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
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch-response',
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
      expect(batchPayload?.data?.[0]?.response?.status).toBe('201');

      const thidSearch = 'medication-search-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_search',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            data: [
              {
                type: 'MedicationStatement-search-request-v1.0',
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.api',
                    'MedicationStatement.subject': 'Organization/subject-001',
                  },
                },
              },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch-response',
          headers: { 'content-type': 'application/json' },
          body: { thid: thidSearch },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(searchPayload?.data?.[0]?.resource?.total).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(searchPayload?.data?.[0]?.resource?.data)).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });
});
