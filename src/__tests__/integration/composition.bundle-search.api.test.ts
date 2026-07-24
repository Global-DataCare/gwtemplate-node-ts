import { invokeExpress } from './helpers/invokeExpress';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import { testTenant1TenantId } from '../data/organization.data';

describe('Composition Bundle _search API (integration)', () => {
  function loadIpsAllSectionsFixture(subjectDid: string): any {
    // Official HL7 IPS fixture used to feed individual, mirror into digitaltwin,
    // and verify section-first `Composition/_search` behavior end to end:
    // https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html
    const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'data', 'fhir-ips-bundle-all-sections.json');
    const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
    for (const entry of Array.isArray(bundle?.entry) ? bundle.entry : []) {
      const resource = entry?.resource;
      if (!resource || typeof resource !== 'object') continue;

      if (resource?.subject?.reference) {
        resource.subject.reference = subjectDid;
      }
      if (resource?.patient?.reference) {
        resource.patient.reference = subjectDid;
      }
      if (resource?.medicationCodeableConcept?.coding?.[0]) {
        resource.medicationCodeableConcept.coding[0].userSelected = true;
        resource.medicationCodeableConcept.text ||= resource.medicationCodeableConcept.coding[0].display;
      }
      if (resource?.code?.coding?.[0]) {
        resource.code.coding[0].userSelected = true;
        resource.code.text ||= resource.code.coding[0].display;
      }
      if (resource?.vaccineCode?.coding?.[0]) {
        resource.vaccineCode.coding[0].userSelected = true;
        resource.vaccineCode.text ||= resource.vaccineCode.coding[0].display;
      }
      if (resource?.category?.[0]?.coding?.[0]) {
        resource.category[0].coding[0].userSelected = true;
        resource.category[0].text ||= resource.category[0].coding[0].display;
      }
    }
    return bundle;
  }

  afterEach(() => {
    resetServerConfig();
  });

  it('supports Bundle/_search over document bundles with composition.subject and composition.section', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch`,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch-response`,
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
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
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

  it('supports Bundle/_search for IPS documents while excluding selected sections', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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

      const subjectDid = 'did:web:api.acme.org:individual:ips-excluded-sections-001';
      const ipsType = `${HealthcareBasicSections.PatientSummaryDocument.system}|${HealthcareBasicSections.PatientSummaryDocument.code}`;
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'individual', 'composition');

      await vaultRepository.put(
        tenantVaultId,
        [
          {
            id: 'composition-medications-001',
            '@context': 'org.hl7.fhir.r4',
            'Composition.identifier': 'urn:uuid:composition-medications-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.author': 'did:web:api.acme.org:employee:doctor1',
            'Composition.date': '2026-05-16T10:00:00Z',
            'Composition.type': ipsType,
          } as any,
          {
            id: 'composition-allergies-001',
            '@context': 'org.hl7.fhir.r4',
            'Composition.identifier': 'urn:uuid:composition-allergies-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
            'Composition.author': 'did:web:api.acme.org:employee:doctor1',
            'Composition.date': '2026-05-16T11:00:00Z',
            'Composition.type': ipsType,
          } as any,
        ],
        compositionSectionId,
      );

      const thidSearch = 'bundle-search-ips-exclude-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
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
                  url:
                    `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}`
                    + `&composition.type=${encodeURIComponent(ipsType)}`
                    + `&composition.section:not=${encodeURIComponent(HealthcareBasicSections.AllergiesAndIntolerances.attributeValue)}`,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
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
      expect(searchPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.resource?.type).toBe('document');
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.resourceType).toBe('Composition');
      expect(searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section).toHaveLength(1);
      expect(
        searchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section?.[0]?.code?.coding?.[0]?.code,
      ).toBe(HealthcareBasicSections.HistoryOfMedicationUse.code);
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
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

  it('supports Bundle/_search for Communication by identifier, thid, and linked DocumentReference contenthash', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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
      const communicationSectionId = getEnvSectionId(`individual_communications_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);
      const documentReferenceSectionId = getEnvSectionId(`individual_document_references_${createHash('sha256').update(subjectDid, 'utf8').digest('hex')}`);

      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'communication-001',
          type: 'CommMsgExtended',
          thid: 'permission-thread-001',
          'Communication.identifier': 'comm-permission-001',
          'Communication.subject': subjectDid,
          'Communication.content-reference': 'DocumentReference/documentreference-001',
        } as any],
        communicationSectionId,
      );
      await vaultRepository.put(
        tenantVaultId,
        [{
          id: 'documentreference-001',
          '@context': 'org.hl7.fhir.r4',
          'DocumentReference.subject': subjectDid,
          'DocumentReference.identifier': 'urn:uuid:docref-001',
          'DocumentReference.contenthash': cid,
        } as any],
        documentReferenceSectionId,
      );

      const searchCases = [
        {
          thid: 'bundle-search-communication-id-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&identifier=${encodeURIComponent('comm-permission-001')}`,
        },
        {
          thid: 'bundle-search-communication-thid-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&thid=${encodeURIComponent('permission-thread-001')}`,
        },
        {
          thid: 'bundle-search-communication-cid-001',
          url: `Communication?subject=${encodeURIComponent(subjectDid)}&contenthash=${encodeURIComponent(cid)}`,
        },
      ];

      for (const searchCase of searchCases) {
        const searchResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid: searchCase.thid,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [
                {
                  request: {
                    method: 'GET',
                    url: searchCase.url,
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
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid: searchCase.thid },
          });
          if (pollResp.status === 200) {
            searchPayload = JSON.parse(pollResp.text);
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        expect(searchPayload?.resourceType).toBe('Bundle');
        expect(searchPayload?.data?.[0]?.response?.status).toBe('200');
        expect(searchPayload?.data?.[0]?.type).toBe('Communication-search-response-v1.0');
        expect(searchPayload?.data?.[0]?.resource?.total).toBe(1);
        expect(searchPayload?.data?.[0]?.resource?.data?.[0]?.['Communication.identifier']).toBe('comm-permission-001');
      }
    } finally {
      queueAdapter.stop();
    }
  });

  it('ingests the IPS all-sections fixture through Communication and supports digitaltwin Composition/_search by section plus display/text', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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

      const subjectDid = 'did:web:api.acme.org:individual:ips-all-sections-001';
      const ipsBundle = loadIpsAllSectionsFixture(subjectDid);
      const documentReference = {
        resourceType: 'DocumentReference',
        id: 'ips-all-sections-document-reference-001',
        subject: { reference: subjectDid },
        date: '2026-06-26T10:00:00Z',
        description: 'IPS with all sections',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:ips-all-sections-document-reference-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'bundle-ips-all-sections.json',
              data: Buffer.from(JSON.stringify(ipsBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-all-sections-communication-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-document-reference.json',
                        data: Buffer.from(JSON.stringify(documentReference), 'utf8').toString('base64'),
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

      let communicationPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-all-sections-communication-001' },
        });
        if (pollResp.status === 200) {
          communicationPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(communicationPayload?.data?.[0]?.response?.status).toBe('200');

      const digitalTwinMedicationsSection = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
      const digitalTwinObservationsSection = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
      const digitalTwinCompositionSection = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
      const medicationRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinMedicationsSection);
      const observationRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinObservationsSection);
      const compositionRecords = await vaultRepository.getContainersInSection<any>(tenantVaultId, digitalTwinCompositionSection);
      expect(medicationRecords.length).toBeGreaterThan(0);
      expect(observationRecords.length).toBeGreaterThan(0);
      expect(compositionRecords.some((record: any) =>
        record['Composition.section'] === HealthcareBasicSections.HistoryOfMedicationUse.attributeValue
        || record['org.hl7.fhir.r4.Composition.section'] === HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      )).toBe(true);
      expect(compositionRecords.some((record: any) =>
        record['Composition.section'] === HealthcareBasicSections.VitalSigns.attributeValue
        || record['org.hl7.fhir.r4.Composition.section'] === HealthcareBasicSections.VitalSigns.attributeValue,
      )).toBe(true);

      const allergiesSection = 'LOINC|48765-2';
      const sectionSubjectDid = 'did:web:api.acme.org:individual:section-only-allergy-001';
      const allergySectionBundle = {
        resourceType: 'Bundle',
        type: 'batch',
        data: [{
          type: 'AllergyIntolerance-edit-request-v1.0',
          resource: {
            resourceType: 'AllergyIntolerance',
            id: 'allergy-section-update-integration-001',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'AllergyIntolerance.identifier': 'urn:uuid:allergy-section-update-integration-001',
              'AllergyIntolerance.subject': sectionSubjectDid,
              'AllergyIntolerance.category': allergiesSection,
              'AllergyIntolerance.criticality': 'high',
              'AllergyIntolerance.clinical-status': 'active',
              'AllergyIntolerance.onset-datetime': '2026-07-24T09:30:00Z',
            } },
          },
        }],
      };

      // Step 1: update exactly one clinical section using the explicit section contract.
      const sectionUpdateResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'allergy-section-update-integration-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              meta: { claims: {
                '@context': 'org.hl7.fhir.r4',
                'Communication.subject': sectionSubjectDid,
                'Composition.section': allergiesSection,
              } },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: sectionSubjectDid },
                payload: [{
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    title: 'allergies-section.json',
                    data: Buffer.from(JSON.stringify(allergySectionBundle), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
        },
      });
      expect(sectionUpdateResp.status).toBe(202);

      let sectionUpdatePayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'allergy-section-update-integration-001' },
        });
        if (pollResp.status === 200) {
          sectionUpdatePayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      // Step 2: verify the section resource and Composition projection exist under the exact code.
      expect(sectionUpdatePayload?.data?.[0]?.response?.status).toBe('200');
      const allergyRecords = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionSubjectDid, 'digitaltwin', 'allergies'),
      );
      const updatedCompositionRecords = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getSubjectScopedSectionId(sectionSubjectDid, 'digitaltwin', 'composition'),
      );
      expect(allergyRecords.some((record: any) =>
        record['AllergyIntolerance.identifier'] === 'urn:uuid:allergy-section-update-integration-001'
        || record['org.hl7.fhir.api.AllergyIntolerance.identifier'] === 'urn:uuid:allergy-section-update-integration-001',
      )).toBe(true);
      expect(updatedCompositionRecords.some((record: any) =>
        record['Composition.section'] === allergiesSection
        || record['org.hl7.fhir.r4.Composition.section'] === allergiesSection,
      )).toBe(true);

      // Step 3: read the section-only update through the canonical summary
      // contract and prove the claims-first AllergyIntolerance is returned.
      const summaryResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'allergy-section-summary-integration-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [{
              request: { method: 'POST', url: 'individual/org.hl7.fhir.api/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: sectionSubjectDid },
                sender: { reference: 'did:web:provider.example.org' },
                payload: [{
                  contentReference: {
                    reference: 'individual/org.hl7.fhir.api/Subject/$summary',
                  },
                  contentAttachment: {
                    contentType: 'application/fhir+json',
                    data: Buffer.from(JSON.stringify({
                      resourceType: 'Parameters',
                      parameter: [
                        { name: 'subject', valueString: sectionSubjectDid },
                        { name: 'section', valueString: allergiesSection },
                      ],
                    }), 'utf8').toString('base64'),
                  },
                }],
              },
            }],
          },
        },
      });
      expect(summaryResp.status).toBe(202);

      let summaryPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'allergy-section-summary-integration-001' },
        });
        if (pollResp.status === 200) {
          summaryPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(summaryPayload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(summaryPayload?.data?.[0]?.resource?.type).toBe('document');
      const allergySummaryEntry = summaryPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === 'AllergyIntolerance');
      expect(allergySummaryEntry?.resource?.meta?.claims).toMatchObject({
        'AllergyIntolerance.identifier': 'urn:uuid:allergy-section-update-integration-001',
        'AllergyIntolerance.subject': sectionSubjectDid,
        'AllergyIntolerance.criticality': 'high',
        'AllergyIntolerance.clinical-status': 'active',
        'AllergyIntolerance.onset-datetime': '2026-07-24T09:30:00Z',
      });

      const searchCases = [
        {
          thid: 'ips-all-sections-med-search-001',
          parameters: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'MedicationStatement.code-display', valueString: 'lisinopril' },
            { name: 'MedicationStatement.code-text', valueString: 'lisinopril' },
          ],
        },
        {
          thid: 'ips-all-sections-vs-search-001',
          parameters: [
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'Observation.code-display', valueString: 'pressure' },
            { name: 'Observation.code-text', valueString: 'pressure' },
          ],
        },
        {
          thid: 'allergy-section-update-search-001',
          expectedSubject: sectionSubjectDid,
          parameters: [
            { name: 'section', valueString: allergiesSection },
            {
              name: 'AllergyIntolerance.identifier',
              valueString: 'urn:uuid:allergy-section-update-integration-001',
            },
          ],
        },
      ];

      for (const searchCase of searchCases) {
        const searchResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_search`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid: searchCase.thid,
            body: {
              resourceType: 'Parameters',
              parameter: searchCase.parameters,
            },
          },
        });
        expect(searchResp.status).toBe(202);

        let searchPayload: any;
        for (let i = 0; i < 50; i++) {
          const pollResp = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid: searchCase.thid },
          });
          if (pollResp.status === 200) {
            searchPayload = JSON.parse(pollResp.text);
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        expect(searchPayload?.resourceType).toBe('Bundle');
        expect(searchPayload?.data?.[0]?.type).toBe('Composition-search-response-v1.0');
        expect(searchPayload?.data?.[0]?.resource?.total).toBeGreaterThanOrEqual(1);
        const firstMatch = searchPayload?.data?.[0]?.resource?.data?.[0];
        expect(
          firstMatch?.['Composition.subject']
          || firstMatch?.['org.hl7.fhir.r4.Composition.subject']
          || firstMatch?.meta?.claims?.['Composition.subject']
          || firstMatch?.meta?.claims?.['org.hl7.fhir.r4.Composition.subject'],
        ).toBe(searchCase.expectedSubject || subjectDid);
      }
    } finally {
      queueAdapter.stop();
    }
  });

  it('stores one researcher branch Composition in digitaltwin and finds it by Composition.meta-tag', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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

      const subjectDid = 'did:web:api.lab.org:research-subject:branch-composition-001';
      const branchCompositionId =
        'urn:twin:researchsubject-branch-composition-001:branch:employee-001:version:01JZ4CV2G1X2M5Y8Y3V4W6Q7R8';
      const branchTag = {
        id: 'Composition.meta.tag[0]',
        system: 'urn:research:tag:score',
        code: '10',
      };

      const digitalTwinCompositionSection = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
      await vaultRepository.put(
        tenantVaultId,
        [
          {
            id: branchCompositionId,
            '@context': 'org.hl7.fhir.api',
            'Composition.identifier': branchCompositionId,
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            'Composition.author': 'did:web:api.lab.org:employee:researcher1@lab.org:ISCO-08|2211',
            'Composition.date': '2026-07-01T10:00:00Z',
            meta: { tag: [branchTag] },
            tag: [branchTag],
          },
        ],
        digitalTwinCompositionSection,
      );

      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'researcher-branch-composition-search-001',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
              { name: 'Composition.meta-tag', valueCoding: { system: 'urn:research:tag:score', code: '10' } },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'researcher-branch-composition-search-001' },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(searchPayload?.resourceType).toBe('Bundle');
      expect(searchPayload?.data?.[0]?.type).toBe('Composition-search-response-v1.0');
      expect(searchPayload?.data?.[0]?.resource?.total).toBe(1);
      expect(searchPayload?.data?.[0]?.resource?.data?.[0]?.id).toBe(branchCompositionId);
      expect(searchPayload?.data?.[0]?.resource?.data?.[0]?.meta?.tag?.[0]?.system).toBe('urn:research:tag:score');
      expect(searchPayload?.data?.[0]?.resource?.data?.[0]?.meta?.tag?.[0]?.code).toBe('10');
    } finally {
      queueAdapter.stop();
    }
  });

  it('materializes selected digital twins through Communication -> ResearchSubject/$summary in r4 and api formats', async () => {
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
      const tenantVaultId = getTenantVaultId(tenantClaims[ClaimsServiceSchemaorg.category], testTenant1TenantId);

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

      const subjectDid = 'did:web:api.acme.org:individual:twin-materialization-001';
      const ipsBundle = loadIpsAllSectionsFixture(subjectDid);
      const documentReference = {
        resourceType: 'DocumentReference',
        id: 'ips-twin-materialization-document-reference-001',
        subject: { reference: subjectDid },
        date: '2026-06-26T10:00:00Z',
        description: 'IPS twin materialization source',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:ips-twin-materialization-document-reference-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'bundle-ips-all-sections.json',
              data: Buffer.from(JSON.stringify(ipsBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const ingestResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-ingest-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T10:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-document-reference.json',
                        data: Buffer.from(JSON.stringify(documentReference), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(ingestResp.status).toBe(202);

      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-ingest-001' },
        });
        if (pollResp.status === 200) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-search-001',
          body: {
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
              { name: 'MedicationStatement.code-display', valueString: 'lisinopril' },
              { name: 'MedicationStatement.code-text', valueString: 'lisinopril' },
            ],
          },
        },
      });
      expect(searchResp.status).toBe(202);

      let searchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-search-001' },
        });
        if (pollResp.status === 200) {
          searchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(searchPayload?.data?.[0]?.resource?.total).toBeGreaterThanOrEqual(1);
      const matchedSubject = searchPayload?.data?.[0]?.resource?.data?.[0]?.['Composition.subject']
        || searchPayload?.data?.[0]?.resource?.data?.[0]?.['org.hl7.fhir.r4.Composition.subject']
        || searchPayload?.data?.[0]?.resource?.data?.[0]?.meta?.claims?.['Composition.subject']
        || searchPayload?.data?.[0]?.resource?.data?.[0]?.meta?.claims?.['org.hl7.fhir.r4.Composition.subject'];
      expect(matchedSubject).toBe(subjectDid);

      const r4MaterializeResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-r4-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'digitaltwin/org.hl7.fhir.r4/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T11:00:00Z',
                  payload: [
                    {
                      contentReference: {
                        reference: `digitaltwin/org.hl7.fhir.r4/ResearchSubject/$summary?subject=${encodeURIComponent(subjectDid)}`,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(r4MaterializeResp.status).toBe(202);

      let r4Payload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-r4-001' },
        });
        if (pollResp.status === 200) {
          r4Payload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(r4Payload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(r4Payload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(r4Payload?.data?.[0]?.resource?.type).toBe('document');
      expect(r4Payload?.data?.[0]?.resource?.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:/);
      expect(r4Payload?.data?.[0]?.resource?.entry?.[0]?.resource?.resourceType).toBe('Composition');
      expect(
        r4Payload?.data?.[0]?.resource?.entry?.some((entry: any) => entry?.resource?.resourceType === 'MedicationStatement'),
      ).toBe(true);
      expect(
        r4Payload?.data?.[0]?.resource?.entry?.some((entry: any) => entry?.resource?.resourceType === 'Observation'),
      ).toBe(true);

      const apiMaterializeResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'ips-twin-materialization-api-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'digitaltwin/org.hl7.fhir.api/Communication' },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-06-26T11:05:00Z',
                  payload: [
                    {
                      contentReference: {
                        reference: 'digitaltwin/org.hl7.fhir.api/ResearchSubject/$summary',
                      },
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        data: Buffer.from(JSON.stringify({
                          resourceType: 'Parameters',
                          parameter: [
                            { name: 'subject', valueString: subjectDid },
                            {
                              name: 'section',
                              valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                            },
                          ],
                        }), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(apiMaterializeResp.status).toBe(202);

      let apiPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'ips-twin-materialization-api-001' },
        });
        if (pollResp.status === 200) {
          apiPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(apiPayload?.data?.[0]?.type).toBe('Bundle-summary-response-v1.0');
      expect(apiPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(apiPayload?.data?.[0]?.resource?.entry?.[0]?.fullUrl).toMatch(/^urn:uuid:/);
      expect(apiPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.section?.[0]?.entry?.length)
        .toBeGreaterThan(0);
      const apiMedicationEntry = apiPayload?.data?.[0]?.resource?.entry
        ?.find((entry: any) => entry?.resource?.resourceType === 'MedicationStatement');
      expect(Object.keys(apiMedicationEntry.resource).sort()).toEqual(['id', 'meta', 'resourceType']);
      expect(apiMedicationEntry.resource.meta.claims).toBeDefined();
      expect(apiMedicationEntry.resource.meta.claims['MedicationStatement.subject']).toBe(subjectDid);
    } finally {
      queueAdapter.stop();
    }
  });
});
