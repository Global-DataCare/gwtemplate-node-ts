import { invokeExpress } from './helpers/invokeExpress';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareBasicSections } from '../../shared/healthcare-constants';
import {
  buildDemoCommunicationDidcommRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../data/demo-communication-medications-ips.data';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { initializeTenantServicesConfig } from '../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { startServer, resetServerConfig } from '../../server';
import { getEnvSectionId } from '../../utils/section-env';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { testTenant1TenantId } from '../data/organization.data';

describe('MedicationStatement API (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('does not create an IPS index section and does not duplicate extracted clinical sections when a replayed IPS changes only container metadata', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:replay-clinical-001';
      const canonicalSectionIds = {
        communications: getSubjectScopedSectionId(subjectDid, 'individual', 'communications'),
        composition: getSubjectScopedSectionId(subjectDid, 'individual', 'composition'),
        documentReferences: getSubjectScopedSectionId(subjectDid, 'individual', 'document-references'),
        medications: getSubjectScopedSectionId(subjectDid, 'individual', 'medications'),
        conditions: getSubjectScopedSectionId(subjectDid, 'individual', 'conditions'),
        allergies: getSubjectScopedSectionId(subjectDid, 'individual', 'allergies'),
        observations: getSubjectScopedSectionId(subjectDid, 'individual', 'observations'),
      };

      const buildIpsDocumentReference = (suffix: string, sent: string) => {
        const documentBundle = {
          resourceType: 'Bundle',
          type: 'document',
          entry: [
            {
              resource: {
                resourceType: 'Composition',
                id: `ips-composition-${suffix}`,
                status: 'final',
                date: sent,
                text: {
                  status: 'generated',
                  div: `<div xmlns="http://www.w3.org/1999/xhtml">IPS ${suffix}</div>`,
                },
                type: {
                  coding: [{
                    system: HealthcareBasicSections.PatientSummaryDocument.system,
                    code: HealthcareBasicSections.PatientSummaryDocument.code,
                    display: 'Patient summary Document',
                  }],
                },
                subject: { reference: subjectDid },
                section: [
                  {
                    code: {
                      coding: [{
                        system: HealthcareBasicSections.HistoryOfMedicationUse.system,
                        code: HealthcareBasicSections.HistoryOfMedicationUse.code,
                      }],
                    },
                    entry: [{ reference: `MedicationStatement/medication-${suffix}` }],
                  },
                  {
                    code: {
                      coding: [{
                        system: HealthcareBasicSections.ProblemList.system,
                        code: HealthcareBasicSections.ProblemList.code,
                      }],
                    },
                    entry: [{ reference: `Condition/condition-${suffix}` }],
                  },
                  {
                    code: {
                      coding: [{
                        system: HealthcareBasicSections.AllergiesAndIntolerances.system,
                        code: HealthcareBasicSections.AllergiesAndIntolerances.code,
                      }],
                    },
                    entry: [{ reference: `AllergyIntolerance/allergy-${suffix}` }],
                  },
                  {
                    code: {
                      coding: [{
                        system: HealthcareBasicSections.Results.system,
                        code: HealthcareBasicSections.Results.code,
                      }],
                    },
                    entry: [{ reference: `Observation/observation-${suffix}` }],
                  },
                ],
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
                  text: 'Paracetamol 500 mg',
                  coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '161' }],
                },
                identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:medication-stable-001' }],
                text: {
                  status: 'generated',
                  div: `<div xmlns="http://www.w3.org/1999/xhtml">Medication ${suffix}</div>`,
                },
              },
            },
            {
              resource: {
                resourceType: 'Condition',
                id: `condition-${suffix}`,
                clinicalStatus: {
                  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                },
                subject: { reference: subjectDid },
                code: {
                  coding: [{ system: 'http://snomed.info/sct', code: '38341003' }],
                  text: 'Hypertension',
                },
                identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:condition-stable-001' }],
                recordedDate: '2026-05-22T10:00:00Z',
                text: {
                  status: 'generated',
                  div: `<div xmlns="http://www.w3.org/1999/xhtml">Condition ${suffix}</div>`,
                },
              },
            },
            {
              resource: {
                resourceType: 'AllergyIntolerance',
                id: `allergy-${suffix}`,
                clinicalStatus: {
                  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
                },
                patient: { reference: subjectDid },
                code: {
                  coding: [{ system: 'http://snomed.info/sct', code: '91936005' }],
                  text: 'Allergy to penicillin',
                },
                identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:allergy-stable-001' }],
                recordedDate: '2026-05-22T10:00:00Z',
                text: {
                  status: 'generated',
                  div: `<div xmlns="http://www.w3.org/1999/xhtml">Allergy ${suffix}</div>`,
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
                identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:observation-stable-001' }],
                text: {
                  status: 'generated',
                  div: `<div xmlns="http://www.w3.org/1999/xhtml">Observation ${suffix}</div>`,
                },
              },
            },
          ],
        };

        return {
          resourceType: 'DocumentReference',
          id: `ips-document-reference-${suffix}`,
          subject: { reference: subjectDid },
          date: sent,
          description: `IPS replay ${suffix}`,
          identifier: [{ system: 'urn:ietf:rfc:3986', value: `urn:uuid:ips-document-reference-${suffix}` }],
          content: [
            {
              attachment: {
                contentType: 'application/fhir+json',
                title: `ips-${suffix}.json`,
                data: Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64'),
              },
            },
          ],
        };
      };

      const waitForBatch = async (thid: string) => {
        for (let i = 0; i < 50; i++) {
          const pollResp = await invokeExpress(app, {
            method: 'POST',
            url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
            headers: { 'content-type': 'application/json' },
            body: { thid },
          });
          if (pollResp.status === 200) return JSON.parse(pollResp.text);
          await new Promise((r) => setTimeout(r, 50));
        }
        return undefined;
      };

      const submitReplay = async (suffix: string, sent: string) => {
        const embeddedDocumentReference = buildIpsDocumentReference(suffix, sent);
        const submitResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
          body: {
            thid: `communication-replay-${suffix}`,
            body: {
              resourceType: 'Bundle',
              type: 'batch',
              entry: [
                {
                  request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                  meta: {
                    claims: {
                      '@context': 'org.hl7.fhir.r4',
                      'Communication.identifier': `comm-replay-${suffix}`,
                      'Communication.subject': subjectDid,
                      'Communication.sent': sent,
                      'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
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
                          title: `ips-document-reference-${suffix}.json`,
                          data: Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64'),
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
        const payload = await waitForBatch(`communication-replay-${suffix}`);
        expect(payload?.resourceType).toBe('Bundle');
        expect(payload?.data?.[0]?.response?.status).toBe('200');
      };

      await submitReplay('v1', '2026-05-22T10:00:00Z');

      const countsAfterFirst = {
        medications: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.medications)).length,
        conditions: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.conditions)).length,
        allergies: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.allergies)).length,
        observations: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.observations)).length,
      };
      expect(countsAfterFirst).toEqual({
        medications: 1,
        conditions: 1,
        allergies: 1,
        observations: 1,
      });

      const allSectionsAfterFirst = await vaultRepository.getAllSections(tenantVaultId);
      const knownSubjectScopedSections = new Set(Object.values(canonicalSectionIds));
      const unexpectedSubjectSections = allSectionsAfterFirst.filter((sectionId) =>
        sectionId.includes('individual_') && !knownSubjectScopedSections.has(sectionId),
      );
      expect(unexpectedSubjectSections).toEqual([]);

      await submitReplay('v2', '2026-06-01T09:30:00Z');

      const countsAfterSecond = {
        medications: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.medications)).length,
        conditions: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.conditions)).length,
        allergies: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.allergies)).length,
        observations: (await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.observations)).length,
      };
      expect(countsAfterSecond).toEqual(countsAfterFirst);
      expect((await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.communications)).length).toBe(2);
      expect((await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.documentReferences)).length).toBe(2);
      expect((await vaultRepository.getContainersInSection(tenantVaultId, canonicalSectionIds.composition)).length).toBeGreaterThanOrEqual(1);
    } finally {
      queueAdapter.stop();
    }
  });

  it('ingests medications via Communication and retrieves them via MedicationStatement/_search and Bundle/_search', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:subject-001';
      const ipsDocumentTypeToken = `${HealthcareBasicSections.PatientSummaryDocument.system}|${HealthcareBasicSections.PatientSummaryDocument.code}`;
      const documentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-001',
              status: 'final',
              type: {
                coding: [{
                  system: HealthcareBasicSections.PatientSummaryDocument.system,
                  code: HealthcareBasicSections.PatientSummaryDocument.code,
                  display: 'Patient summary Document',
                }],
              },
              subject: { reference: subjectDid },
              date: '2026-05-22T10:00:00Z',
              title: 'IPS Medication Summary',
              section: [
                {
                  code: { coding: [{
                    system: HealthcareBasicSections.HistoryOfMedicationUse.system,
                    code: HealthcareBasicSections.HistoryOfMedicationUse.code,
                    display: 'History of Medication Use',
                  }] },
                  entry: [{ reference: 'urn:uuid:medication-001' }],
                },
              ],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-001',
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T10:00:00Z',
              medicationCodeableConcept: { text: 'Paracetamol 500mg cada 8 horas' },
              note: [{ text: 'Frecuencia reportada por paciente: cada 8 horas' }],
              identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:medication-001' }],
            },
          },
        ],
      };
      const documentBundleB64 = Buffer.from(JSON.stringify(documentBundle), 'utf8').toString('base64');
      const embeddedDocumentReference = {
        resourceType: 'DocumentReference',
        id: 'ips-document-reference-001',
        subject: { reference: subjectDid },
        date: '2026-05-22T10:00:00Z',
        description: 'IPS Medication Summary',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:ips-document-reference-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-medications.json',
              data: documentBundleB64,
            },
          },
        ],
      };
      const embeddedDocumentReferenceB64 = Buffer.from(JSON.stringify(embeddedDocumentReference), 'utf8').toString('base64');

      const thidBatch = 'communication-medication-batch-001';
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
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
                    'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
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
                        title: 'ips-document-reference.json',
                        data: embeddedDocumentReferenceB64,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
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

      const thidSearch = 'medication-search-001';
      const searchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_search`,
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
                    'MedicationStatement.subject': subjectDid,
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
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch-response`,
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

      const thidIpsSearch = 'ips-bundle-search-001';
      const ipsSearchReference = `individual/org.hl7.fhir.r4/Bundle/_search?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=${encodeURIComponent(ipsDocumentTypeToken)}`;
      const ipsSearchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidIpsSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: {
                  method: 'GET',
                  url: `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}&composition.type=${encodeURIComponent(ipsDocumentTypeToken)}`,
                },
              },
            ],
          },
        },
      });
      expect(ipsSearchResp.status).toBe(202);

      let ipsSearchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Bundle/_search-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidIpsSearch },
        });
        if (pollResp.status === 200) {
          ipsSearchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ipsSearchPayload?.resourceType).toBe('Bundle');
      expect(ipsSearchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(ipsSearchPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(ipsSearchPayload?.data?.[0]?.resource?.type).toBe('document');
      expect(ipsSearchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.resourceType).toBe('Composition');
      expect(ipsSearchPayload?.data?.[0]?.resource?.entry?.[0]?.resource?.type?.coding?.[0]?.code).toBe(
        HealthcareBasicSections.PatientSummaryDocument.code,
      );
      expect(
        ipsSearchPayload?.data?.[0]?.resource?.entry
          ?.filter((entry: any) => entry?.resource?.resourceType === 'MedicationStatement')
          ?.length,
      ).toBe(1);

      const thidCommunicationSearch = 'communication-ips-search-001';
      const communicationSearchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: thidCommunicationSearch,
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.r4',
                    'Communication.identifier': 'comm-ips-search-001',
                    'Communication.subject': subjectDid,
                    'Communication.sent': '2026-05-22T12:00:00Z',
                  },
                },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T12:00:00Z',
                  payload: [
                    {
                      contentReference: {
                        reference: ipsSearchReference,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(communicationSearchResp.status).toBe(202);

      let communicationSearchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: thidCommunicationSearch },
        });
        if (pollResp.status === 200) {
          communicationSearchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(communicationSearchPayload?.resourceType).toBe('Bundle');
      expect(communicationSearchPayload?.data?.[0]?.type).toBe('Bundle-search-response-v1.0');
      expect(communicationSearchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(communicationSearchPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(communicationSearchPayload?.data?.[0]?.resource?.type).toBe('document');
      expect(
        communicationSearchPayload?.data?.[0]?.resource?.entry
          ?.filter((entry: any) => entry?.resource?.resourceType === 'MedicationStatement')
          ?.length,
      ).toBe(1);
    } finally {
      queueAdapter.stop();
    }
  });

  it('returns the IPS example sections with two extra MedicationStatement resources after two later medication communications', async () => {
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

      const subjectDid = 'did:web:api.acme.org:individual:subject-ips-plus-two-medications-001';
      const ipsDocumentTypeToken = `${HealthcareBasicSections.PatientSummaryDocument.system}|${HealthcareBasicSections.PatientSummaryDocument.code}`;
      const baseDocumentBundle = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [
          {
            resource: {
              resourceType: 'Composition',
              id: 'ips-composition-base-001',
              status: 'final',
              type: {
                coding: [{
                  system: HealthcareBasicSections.PatientSummaryDocument.system,
                  code: HealthcareBasicSections.PatientSummaryDocument.code,
                  display: 'Patient summary Document',
                }],
              },
              subject: { reference: subjectDid },
              date: '2026-05-22T09:00:00Z',
              title: 'IPS Medication Summary',
              section: [
                {
                  code: {
                    coding: [{
                      system: HealthcareBasicSections.HistoryOfMedicationUse.system,
                      code: HealthcareBasicSections.HistoryOfMedicationUse.code,
                      display: 'History of Medication Use',
                    }],
                  },
                  entry: [{ reference: 'urn:uuid:medication-base-001' }],
                },
              ],
            },
          },
          {
            resource: {
              resourceType: 'MedicationStatement',
              id: 'medication-base-001',
              status: 'active',
              subject: { reference: subjectDid },
              effectiveDateTime: '2026-05-22T09:00:00Z',
              medicationCodeableConcept: { text: 'Aspirin 100 mg' },
              note: [{ text: 'Baseline medication already present in the IPS example bundle.' }],
              identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:medication-base-001' }],
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'MedicationStatement.identifier': 'urn:uuid:medication-base-001',
                  'MedicationStatement.subject': subjectDid,
                  'MedicationStatement.status': 'active',
                  'MedicationStatement.medication-text': 'Aspirin 100 mg',
                  'MedicationStatement.effective': '2026-05-22T09:00:00Z',
                  'MedicationStatement.note': 'Baseline medication already present in the IPS example bundle.',
                  'MedicationStatement.category': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                },
              },
            },
          },
        ],
      };

      const baseDocumentReference = {
        resourceType: 'DocumentReference',
        id: 'ips-document-reference-base-001',
        subject: { reference: subjectDid },
        date: '2026-05-22T09:00:00Z',
        description: 'IPS Medication Summary',
        identifier: [{ system: 'urn:ietf:rfc:3986', value: 'urn:uuid:ips-document-reference-base-001' }],
        content: [
          {
            attachment: {
              contentType: 'application/fhir+json',
              title: 'ips-base-medications.json',
              data: Buffer.from(JSON.stringify(baseDocumentBundle), 'utf8').toString('base64'),
            },
          },
        ],
      };

      const baseSubmitResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'communication-ips-base-001',
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
                    'Communication.sent': '2026-05-22T09:00:00Z',
                    'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
                  },
                },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T09:00:00Z',
                  payload: [
                    {
                      contentAttachment: {
                        contentType: 'application/fhir+json',
                        title: 'ips-base-document-reference.json',
                        data: Buffer.from(JSON.stringify(baseDocumentReference), 'utf8').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(baseSubmitResp.status).toBe(202);

      let baseBatchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'communication-ips-base-001' },
        });
        if (pollResp.status === 200) {
          baseBatchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(baseBatchPayload?.data?.[0]?.response?.status).toBe('200');

      const firstMedicationRequest = buildDemoCommunicationDidcommRequest({
        ...demoCommunicationMedicationIpsDefaults,
        subjectId: subjectDid,
        thidComm: 'communication-extra-medication-001',
        thidMedSearch: 'medication-search-unused-001',
        thidIpsSearch: 'ips-search-unused-001',
        medicationCaseIndex: 0,
        demoCompositionId: 'ips-composition-extra-001',
        demoDocumentReferenceId: 'ips-document-reference-extra-001',
        demoDocumentReferenceIdentifier: 'urn:uuid:ips-document-reference-extra-001',
        demoCompositionTitle: 'IPS Medication Summary',
      } as any);
      const firstMedicationResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: firstMedicationRequest,
      });
      expect(firstMedicationResp.status).toBe(202);

      let firstMedicationBatchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'communication-extra-medication-001' },
        });
        if (pollResp.status === 200) {
          firstMedicationBatchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(firstMedicationBatchPayload?.data?.[0]?.response?.status).toBe('200');

      const secondMedicationRequest = buildDemoCommunicationDidcommRequest({
        ...demoCommunicationMedicationIpsDefaults,
        subjectId: subjectDid,
        thidComm: 'communication-extra-medication-002',
        thidMedSearch: 'medication-search-unused-002',
        thidIpsSearch: 'ips-search-unused-002',
        medicationCaseIndex: 1,
        demoCompositionId: 'ips-composition-extra-002',
        demoDocumentReferenceId: 'ips-document-reference-extra-002',
        demoDocumentReferenceIdentifier: 'urn:uuid:ips-document-reference-extra-002',
        demoCompositionTitle: 'IPS Medication Summary',
      } as any);
      const secondMedicationResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: secondMedicationRequest,
      });
      expect(secondMedicationResp.status).toBe(202);

      let secondMedicationBatchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'communication-extra-medication-002' },
        });
        if (pollResp.status === 200) {
          secondMedicationBatchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(secondMedicationBatchPayload?.data?.[0]?.response?.status).toBe('200');

      const ipsSearchReference =
        `individual/org.hl7.fhir.r4/Bundle/_search?type=document`
        + `&composition.subject=${encodeURIComponent(subjectDid)}`
        + `&composition.type=${encodeURIComponent(ipsDocumentTypeToken)}`;

      const communicationSearchResp = await invokeExpress(app, {
        method: 'POST',
        url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo-token' },
        body: {
          thid: 'communication-ips-search-plus-two-001',
          body: {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
              {
                request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
                meta: {
                  claims: {
                    '@context': 'org.hl7.fhir.r4',
                    'Communication.identifier': 'comm-ips-search-plus-two-001',
                    'Communication.subject': subjectDid,
                    'Communication.sent': '2026-05-22T12:00:00Z',
                  },
                },
                resource: {
                  resourceType: 'Communication',
                  status: 'completed',
                  subject: { reference: subjectDid },
                  sent: '2026-05-22T12:00:00Z',
                  payload: [
                    {
                      contentReference: {
                        reference: ipsSearchReference,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });
      expect(communicationSearchResp.status).toBe(202);

      let communicationSearchPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1TenantId}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'communication-ips-search-plus-two-001' },
        });
        if (pollResp.status === 200) {
          communicationSearchPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(communicationSearchPayload?.resourceType).toBe('Bundle');
      expect(communicationSearchPayload?.data?.[0]?.type).toBe('Bundle-search-response-v1.0');
      expect(communicationSearchPayload?.data?.[0]?.response?.status).toBe('200');
      expect(communicationSearchPayload?.data?.[0]?.resource?.resourceType).toBe('Bundle');
      expect(communicationSearchPayload?.data?.[0]?.resource?.type).toBe('document');

      const composition = communicationSearchPayload?.data?.[0]?.resource?.entry?.[0]?.resource;
      expect(composition?.resourceType).toBe('Composition');
      expect(Array.isArray(composition?.section)).toBe(true);
      expect(composition?.section?.length).toBe(1);
      expect(composition?.section?.[0]?.code?.coding?.[0]?.code).toBe(
        HealthcareBasicSections.HistoryOfMedicationUse.code,
      );
      expect(composition?.section?.[0]?.entry?.length).toBe(3);

      const medicationEntries = communicationSearchPayload?.data?.[0]?.resource?.entry
        ?.filter((entry: any) => entry?.resource?.resourceType === 'MedicationStatement');
      expect(medicationEntries?.length).toBe(3);
      expect(
        medicationEntries?.map((entry: any) => entry?.resource?.medicationCodeableConcept?.text),
      ).toEqual(expect.arrayContaining([
        'Aspirin 100 mg',
        'Ibuprofen 400 mg',
        'Paracetamol 600 mg',
      ]));
    } finally {
      queueAdapter.stop();
    }
  });
});
