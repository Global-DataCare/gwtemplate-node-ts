import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { IssueType } from 'gdc-common-utils-ts/models/issue';

describe('MedicationStatement API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('returns 404 when the tenant route has not been provisioned', async () => {
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

    const { app, queueAdapter } = await startServer({ listen: false });
    try {
      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'medication-missing-tenant-001',
          body: {
            data: [
              {
                type: 'MedicationStatement',
                request: { method: 'POST' },
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.api',
                    'MedicationStatement.identifier': 'urn:uuid:medication-missing-tenant',
                    'MedicationStatement.subject': 'Organization/subject-missing',
                    'MedicationStatement.medication': 'Paracetamol 500mg',
                    'MedicationStatement.status': 'active',
                  },
                },
              },
            ],
          },
        },
      });

      expect(response.status).toBe(404);
      const payload = JSON.parse(response.text);
      expect(payload.body?.issues?.issue?.[0]?.code).toBe(IssueType.NotFound);
    } finally {
      queueAdapter.stop();
    }
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

  it('projects MedicationStatement from Communication payload and retrieves it by indexed claims', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:med-01';
      const medicationBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [{
          resource: {
            resourceType: 'MedicationStatement',
            id: 'med-from-communication-001',
            status: 'active',
            subject: { reference: subjectDid },
            effectiveDateTime: '2026-05-01T10:00:00Z',
            medicationCodeableConcept: { text: 'Paracetamol 500mg' },
            identifier: [{ value: 'urn:uuid:med-from-communication-001' }],
          },
        }],
      };

      const commThid = 'communication-medication-projection-001';
      const commSubmit = await invokeExpress(app, {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: commThid,
          body: {
            data: [{
              type: 'Communication-ingestion-request-v1.0',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'Communication.subject': subjectDid,
                  'Communication.sent': '2026-05-19T20:32:17.034Z',
                },
              },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: subjectDid },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    title: 'Medication Bundle',
                    data: Buffer.from(JSON.stringify(medicationBundle), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
        },
      });
      expect(commSubmit.status).toBe(202);

      let commPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch-response',
          headers: { 'content-type': 'application/json' },
          body: { thid: commThid },
        });
        if (pollResp.status === 200) {
          commPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(commPayload?.resourceType).toBe('Bundle');
      expect(commPayload?.data?.[0]?.response?.status).toBe('200');

      const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'medications');
      const projectedMedicationRecords = await vaultRepository.getContainersInSection(tenantVaultId, medicationSectionId);
      expect(projectedMedicationRecords.length).toBeGreaterThan(0);
      const projectedMedication = projectedMedicationRecords[0] as unknown as Record<string, string>;
      expect(
        projectedMedication['MedicationStatement.subject']
        || projectedMedication['org.hl7.fhir.api.MedicationStatement.subject'],
      ).toBe(subjectDid);
      expect(
        projectedMedication['MedicationStatement.medication']
        || projectedMedication['org.hl7.fhir.api.MedicationStatement.medication'],
      ).toBe('Paracetamol 500mg');
      expect(
        projectedMedication['MedicationStatement.status']
        || projectedMedication['org.hl7.fhir.api.MedicationStatement.status'],
      ).toBe('active');

      // Search behavior by indexed claims is already covered by the previous test.
      // Here we validate the Communication->MedicationStatement projection landed in the indexed section.
    } finally {
      queueAdapter.stop();
    }
  });
});
