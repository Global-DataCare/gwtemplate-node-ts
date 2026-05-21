import { invokeExpress } from './helpers/invokeExpress';
import { createHash } from 'crypto';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';

describe('Composition Bundle _search API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('supports Bundle/_search with composition.subject and composition.section', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:123';
      const sectionCode = 'LOINC|60591-5';

      const thidBatch = 'composition-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidBatch,
          body: {
            data: [
              {
                type: 'Composition',
                request: { method: 'POST' },
                resource: {
                  resourceType: 'Composition',
                  id: 'composition-001',
                  meta: {
                    claims: {
                      '@context': 'org.hl7.fhir.r4',
                      'Composition.identifier': 'urn:uuid:composition-001',
                      'Composition.subject': subjectDid,
                      'Composition.section': sectionCode,
                      'Composition.author': 'did:web:api.acme.org:employee:doctor1',
                      'Composition.date': '2026-05-16T10:00:00Z',
                      'Composition.type': 'LOINC|60591-5',
                    },
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
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch-response',
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

      const thidSearch = 'bundle-search-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url: `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.section=${encodeURIComponent(sectionCode)}`,
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
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response',
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
      expect(searchPayload?.data?.[0]?.resource?.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(searchPayload?.data?.[0]?.resource?.data)).toBe(true);
      expect(searchPayload?.data?.[0]?.resource?.data?.length).toBeGreaterThanOrEqual(1);
    } finally {
      queueAdapter.stop();
    }
  });

  it('supports Bundle/_search for DocumentReference by contenthash', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:123';
      const cid = 'zb2rhfJk6M9MHiMagUhM6YJ6R7Sx9nN2m7r8cfDkQ2uYbGxZq';
      const sectionId = getEnvSectionId(`individual_document_references_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);
      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'documentreference-001',
          '@context': 'org.hl7.fhir.r4',
          'DocumentReference.subject': subjectDid,
          'DocumentReference.identifier': 'urn:uuid:docref-001',
          'DocumentReference.contenthash': cid,
          'DocumentReference.contenttype': 'application/pdf',
        } as any],
        sectionId,
      );

      const thidSearch = 'bundle-search-docref-hash-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url: `DocumentReference?subject=${encodeURIComponent(subjectDid)}&contenthash=${encodeURIComponent(cid)}`,
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
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response',
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
      expect(searchPayload?.data?.[0]?.type).toBe('DocumentReference-search-response-v1.0');
      expect(searchPayload?.data?.[0]?.resource?.total).toBe(1);
      expect(searchPayload?.data?.[0]?.resource?.data?.[0]?.['DocumentReference.contenthash']).toBe(cid);
    } finally {
      queueAdapter.stop();
    }
  });
});
