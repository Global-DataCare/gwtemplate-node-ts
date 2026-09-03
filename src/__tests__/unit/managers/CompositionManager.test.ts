// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CompositionManager.test.ts
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  CompositionManager,
} from '../../../managers/CompositionManager';
import { TwinCompositionManager, TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from '../../../managers/TwinCompositionManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import {
  DataCollectionIds,
  HealthcareBasicSections,
  HealthcareSummarySections,
} from 'gdc-common-utils-ts/constants/index';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  COMPOSITION_SEARCH_BUNDLE_EXAMPLE,
  COMPOSITION_SEARCH_PARAMETERS_EXAMPLE,
} from '../../../api-examples';
import { buildOrganizationDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import {
  EXAMPLE_HOST_PUBLIC_HOSTNAME,
  EXAMPLE_ROUTE_VERSION,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_TENANT_ROUTE_CONTEXT,
  EXAMPLE_TENANT_SERVICE_DID,
  EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
  EXAMPLE_PROFESSIONAL_DID,
} from 'gdc-common-utils-ts/examples/shared';
import {
  ExampleEmployeeEmails,
  ExampleEmployeeRoles,
} from 'gdc-common-utils-ts/examples/employee';
import { getDigitalTwinSubjectAliasSectionId } from '../../../utils/digital-twin-research-projection';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import {
  EXAMPLE_RESEARCHER_WORKING_SELECTION_SUBJECT_ID,
  buildResearcherWorkingSelectionBundle,
} from 'gdc-common-utils-ts/examples/researcher-working-selection';

const HOSTED_ORGANIZATION_DID = buildOrganizationDidWeb({
  hostDidWeb: `did:web:${EXAMPLE_HOST_PUBLIC_HOSTNAME}`,
  tenantId: EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId,
  jurisdiction: EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction,
  version: EXAMPLE_ROUTE_VERSION,
  sector: EXAMPLE_TENANT_ROUTE_CONTEXT.sector,
});
const OPERATIONAL_EMPLOYEE_DID = buildProfessionalDidWeb({
  organizationDidWeb: HOSTED_ORGANIZATION_DID,
  email: ExampleEmployeeEmails.SharedProfessional,
  role: ExampleEmployeeRoles.Doctor,
});
const REGISTERED_TWIN_SUBJECT = EXAMPLE_RESEARCHER_WORKING_SELECTION_SUBJECT_ID;

/**
 * Flow contract: authorized callers search one tenant's pseudonymous twins;
 * basic discovery applies OR across requested IPS sections and AND across
 * text and clinical-date constraints on the same resource, then returns each
 * twin Composition once without exposing the internal search document.
 */
describe('CompositionManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getContainersInSection: jest.fn(),
    listContainersInSection: jest.fn(),
    getAllSections: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new CompositionManager(mockVaultRepository);
  const twinManager = new TwinCompositionManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => (
      sectionId === getDigitalTwinSubjectAliasSectionId()
        ? [{ id: 'source-subject-hash', twinSubjectId: REGISTERED_TWIN_SUBJECT }]
        : []
    ) as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
    mockVaultRepository.get.mockResolvedValue({ twinSubjectId: REGISTERED_TWIN_SUBJECT } as any);
    mockVaultRepository.delete.mockResolvedValue(true as any);
  });

  const createJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-comp-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'animal-research',
    section: 'digitaltwin',
    format: 'org.hl7.fhir.api',
    resourceType: ResourceTypesFhirR4.Composition,
    action: '_batch',
    content: {
      jti: 'jti-comp-1',
      thid: 'thid-comp-1',
      iss: EXAMPLE_PROFESSIONAL_DID,
      aud: 'did:web:api.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: buildResearcherWorkingSelectionBundle({
          subjectId: REGISTERED_TWIN_SUBJECT,
        }).entry,
      } as any,
    } as any,
    ...overrides,
  });

  it('fails fast when job.section is missing', async () => {
    const job = createJob({ section: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing required job.section');
  });

  it('returns polling path without resource id and stores in digitaltwin scope', async () => {
    const job = createJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/animal-research/digitaltwin/org.hl7.fhir.api/Composition/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/Composition\/[0-9a-f]{8,}/i);

    const expectedSectionId = getSubjectScopedSectionId(
      REGISTERED_TWIN_SUBJECT,
      'digitaltwin',
      'composition',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('animal-research_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('rejects a digital-twin working selection whose author differs from the authenticated employee', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims[CompositionClaim.Author] = `${OPERATIONAL_EMPLOYEE_DID}:another`;
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        meta: { bearer: { jwt: { payload: { sub: OPERATIONAL_EMPLOYEE_DID } } } },
        body: { resourceType: ResourceTypesFhirR4.Bundle, type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('author must match the authenticated employee');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('rejects a direct canonical digital-twin Composition write', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    delete entry.resource.meta.claims['@type'];
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: ResourceTypesFhirR4.Bundle, type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('ResearcherWorkingSelection');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('purges only the private individual-to-twin link during index-provider offboarding', async () => {
    const sourceSubject = 'did:web:patient.example.org:individual:real-subject';
    const response = await manager.process(createJob({
      section: 'individual',
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      action: '_purge',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'subject', valueString: sourceSubject }],
        },
      } as any,
    }));

    expect((response.body as any).resourceType).toBe('Parameters');
    expect((response.body as any).parameter).toEqual([{ name: 'purged', valueBoolean: true }]);
    expect(mockVaultRepository.delete).toHaveBeenCalledTimes(1);
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
  });

  it('rejects a working selection whose subject is an operational DID', async () => {
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims[CompositionClaim.Subject] = EXAMPLE_SUBJECT_DID;
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: ResourceTypesFhirR4.Bundle, type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('valid urn:uuid');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('rejects an invented UUID URN that is absent from the private alias registry', async () => {
    mockVaultRepository.getContainersInSection.mockResolvedValue([] as any);
    const entry = structuredClone((createJob().content as any).body.entry[0]);
    entry.resource.meta.claims[CompositionClaim.Subject] = `urn:uuid:${EXAMPLE_LICENSE_SEAT_UUID_ACTIVE}`;
    const response = await manager.process(createJob({
      content: {
        ...(createJob().content as any),
        body: { resourceType: ResourceTypesFhirR4.Bundle, type: 'batch', entry: [entry] },
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(JSON.stringify(data[0])).toContain('not registered for this tenant');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('ignores OperationOutcome entries from preconversion payload', async () => {
    const job = createJob({
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          data: [
            {
              resource: {
                resourceType: ResourceTypesFhirR4.OperationOutcome,
                issue: [
                  {
                    severity: 'warning',
                    code: 'processing',
                    diagnostics: 'Missing required LOINC mapping for section:family',
                  },
                ],
              },
            },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe('OperationOutcome');
    expect(data[0].response.status).toBe('200');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('supports _search with FHIR Bundle entry.request.url format', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_BUNDLE_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.CompositionSearch);
    expect(extractBundleSearchResources(response)).toHaveLength(1);
  });

  it('supports _search with FHIR Parameters format', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }, { id: 'comp-2' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_PARAMETERS_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.CompositionSearch);
    expect(extractBundleSearchResources(response)).toHaveLength(2);
  });

  it('supports _search with POST wrapper entries carrying FHIR Parameters', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
    const job = createJob({
      action: '_search',
      section: 'individual',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [
            {
              request: {
                method: HttpRequestMethods.Post,
                url: 'Bundle/_search',
              },
              resource: {
                resourceType: ResourceTypesFhirR4.Parameters,
                parameter: [
                  ...COMPOSITION_SEARCH_PARAMETERS_EXAMPLE.parameter,
                ],
              },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.CompositionSearch);
    expect(extractBundleSearchResources(response)).toHaveLength(1);
  });

  it('supports Subject/$summary with FHIR Parameters format in supported sectors', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:summary-subject-001';
    mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', 'composition')) {
        return [
          {
            id: 'composition-summary-001',
            'Composition.identifier': 'composition-summary-001',
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            [CompositionClaim.Date]: '2026-06-01T10:00:00Z',
            [CompositionClaim.Author]: EXAMPLE_TENANT_SERVICE_DID,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.BundleSummary);
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
  });

  it('rejects digitaltwin materialization for an operational subject DID', async () => {
    const operationalSubjectDid = 'did:web:api.acme.org:individual:summary-subject-001';
    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'subject', valueString: operationalSubjectDid }],
        },
      } as any,
    });

    await expect(manager.process(job)).rejects.toThrow('tenant-registered urn:uuid');
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.r4 materialization', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.composition)) {
        return [
          {
            id: 'composition-twin-summary-001',
            'Composition.identifier': 'urn:uuid:composition-twin-summary-001',
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            [CompositionClaim.Date]: '2026-06-01T10:00:00Z',
            [CompositionClaim.Author]: EXAMPLE_TENANT_SERVICE_DID,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.medications)) {
        return [
          {
            id: 'medication-twin-summary-001',
            'MedicationStatement.identifier': 'urn:uuid:medication-twin-summary-001',
            'MedicationStatement.subject': subjectDid,
            'MedicationStatement.status': 'active',
            'MedicationStatement.medication-text': 'Lisinopril 10 mg',
            'MedicationStatement.code-display': 'Lisinopril 10 MG Oral Tablet',
            'MedicationStatement.code-text': 'Lisinopril 10 mg',
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.BundleSummary);
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
    expect(data[0].resource.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(data[0].resource.entry[0].resource.resourceType).toBe('Composition');
    expect(data[0].resource.entry.some((entry: any) => entry.resource?.resourceType === 'MedicationStatement')).toBe(true);
  });

  it('returns one current native Immunization per business identifier in $summary', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:immunization-summary-001';
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.composition)) {
        return [{
          id: 'composition-immunization-summary-001',
          'Composition.identifier': 'urn:uuid:composition-immunization-summary-001',
          [CompositionClaim.Subject]: subjectDid,
          [CompositionClaim.Section]: HealthcareBasicSections.Immunizations.attributeValue,
          [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
        }] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', DataCollectionIds.immunizations)) {
        return [
          {
            id: 'old-storage-version',
            'Immunization.identifier': 'urn:uuid:covid-dose-2',
            'Immunization.subject': subjectDid,
            'Immunization.status': 'completed',
            'Immunization.date': '2026-01-01T10:00:00Z',
            'Immunization.vaccine-code': 'http://hl7.org/fhir/sid/cvx|208',
            'Immunization.lot-number': 'OLD-LOT',
          },
          {
            id: 'current-storage-version',
            'Immunization.identifier': 'urn:uuid:covid-dose-2',
            'Immunization.subject': subjectDid,
            'Immunization.status': 'completed',
            'Immunization.date': '2026-01-01T10:00:00Z',
            'Immunization.vaccine-code': 'http://hl7.org/fhir/sid/cvx|208',
            'Immunization.lot-number': 'CURRENT-LOT',
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      sector: 'health-care',
      section: 'individual',
      format: 'org.hl7.fhir.r4',
      resourceType: 'Subject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'subject', valueString: subjectDid }],
        },
      } as any,
    }));

    const bundle = (response.body as any).data[0].resource;
    const immunizations = bundle.entry.filter((entry: any) => entry.resource?.resourceType === 'Immunization');
    expect(immunizations).toHaveLength(1);
    expect(immunizations[0].resource).toMatchObject({
      identifier: [{ value: 'urn:uuid:covid-dose-2' }],
      status: 'completed',
      occurrenceDateTime: '2026-01-01T10:00:00Z',
      lotNumber: 'CURRENT-LOT',
    });
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.api claims-first materialization', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.composition)) {
        return [
          {
            id: 'composition-twin-summary-api-001',
            '@context': 'org.hl7.fhir.r4',
            'org.hl7.fhir.r4.Composition.identifier': 'urn:uuid:composition-twin-summary-api-001',
            'org.hl7.fhir.r4.Composition.subject': subjectDid,
            'org.hl7.fhir.r4.Composition.section': HealthcareBasicSections.VitalSigns.attributeValue,
            'org.hl7.fhir.r4.Composition.date': '2026-06-01T10:00:00Z',
            'org.hl7.fhir.r4.Composition.author': EXAMPLE_TENANT_SERVICE_DID,
            'org.hl7.fhir.r4.Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.observations)) {
        return [
          {
            id: 'observation-twin-summary-api-001',
            '@context': 'org.hl7.fhir.r4',
            'org.hl7.fhir.r4.Observation.identifier': 'urn:uuid:observation-twin-summary-api-001',
            'org.hl7.fhir.r4.Observation.subject': subjectDid,
            'org.hl7.fhir.r4.Observation.status': 'final',
            'org.hl7.fhir.r4.Observation.CodeTextLocal': 'Blood pressure systolic',
            'org.hl7.fhir.r4.Observation.CodeDisplay': 'Blood pressure',
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.api',
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const bundle = data[0].resource;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.BundleSummary);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(bundle.entry[0].resource).toEqual(expect.objectContaining({
      resourceType: ResourceTypesFhirR4.Composition,
      id: expect.any(String),
      meta: {
        claims: expect.objectContaining({
          [CompositionClaim.Subject]: subjectDid,
        }),
      },
    }));
    const nonCompositionEntry = bundle.entry.find((entry: any) => entry.resource?.resourceType === 'Observation');
    expect(nonCompositionEntry.resource).toEqual({
      resourceType: ResourceTypesFhirR4.Observation,
      id: 'observation-twin-summary-api-001',
      meta: {
        claims: expect.objectContaining({
          'Observation.subject': subjectDid,
          'Observation.code-text': 'Blood pressure systolic',
          'Observation.code-display': 'Blood pressure',
        }),
      },
    });
    expect(nonCompositionEntry.resource.meta.claims).not.toHaveProperty('Observation.CodeTextLocal');
    expect(nonCompositionEntry.resource.meta.claims).not.toHaveProperty('Observation.CodeDisplay');
  });

  it('declares the searchable digital twin IPS section to resource map', () => {
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.HistoryOfMedicationUse.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.medications], resourceType: ResourceTypesFhirR4.MedicationStatement },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.VitalSigns.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.AdvanceDirectives.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.consents], resourceType: ResourceTypesFhirR4.Consent },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareSummarySections.PregnancyHistory.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
    ]);
  });

  it('searches text across several sections and resource types inside an inclusive date range', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const medicationSection = HealthcareBasicSections.HistoryOfMedicationUse.attributeValue;
    const resultSection = HealthcareBasicSections.Results.attributeValue;
    const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      medicationSectionId,
      observationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === medicationSectionId) return [{
        id: 'medication-search-document',
        'MedicationStatement.subject': subjectDid,
        '__digitalTwinSearch.text': 'Tratamiento antiinflamatorio\u001fIbuprofen',
        '__digitalTwinSearch.date': '2026-04-10T12:00:00.000Z',
      }] as any;
      if (sectionId === observationSectionId) return [{
        id: 'observation-outside-range',
        'Observation.subject': subjectDid,
        '__digitalTwinSearch.text': 'Ibuprofen plasma level',
        '__digitalTwinSearch.date': '2024-04-10T12:00:00.000Z',
      }] as any;
      if (sectionId === compositionSectionId) return [{
        id: 'composition-basic-search',
        [CompositionClaim.Subject]: subjectDid,
        [CompositionClaim.Section]: `${medicationSection},${resultSection}`,
      }] as any;
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: medicationSection },
            { name: 'section', valueString: resultSection },
            { name: 'date-from', valueDate: '2026-01-01' },
            { name: 'text', valueString: 'IBUPROFEN' },
          ],
        },
      } as any,
    }));

    const results = extractBundleSearchResources(response);
    expect(results).toEqual([expect.objectContaining({ id: 'composition-basic-search' })]);
    expect(JSON.stringify(results)).not.toContain('__digitalTwinSearch');
  });

  it('rejects a basic search whose end date precedes its start date', async () => {
    await expect(manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.Results.attributeValue },
            { name: 'date-from', valueDate: '2026-08-20' },
            { name: 'date-to', valueDate: '2026-08-01' },
            { name: 'text', valueString: 'pressure' },
          ],
        },
      } as any,
    }))).rejects.toThrow('date-to must be on or after date-from');
  });

  const searchableSectionFixtures = [
    {
      title: 'History of Medication Use / MedicationStatement',
      subjectDid: 'did:web:api.acme.org:research-subject:med-001',
      sectionToken: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      resourceType: ResourceTypesFhirR4.MedicationStatement,
      sectionIdSuffix: 'medications',
      displayClaimKey: 'MedicationStatement.code-display',
      displayValue: 'Paracetamol 500 MG Oral Tablet',
      displaySearchValue: 'oral tablet',
      textClaimKey: 'MedicationStatement.code-text',
      textValue: 'Paracetamol oral treatment',
      textSearchValue: 'treatment',
      expectedCompositionId: 'comp-med-1',
    },
    {
      title: 'Allergies and Intolerances / AllergyIntolerance',
      subjectDid: 'did:web:api.acme.org:research-subject:alg-001',
      sectionToken: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      resourceType: ResourceTypesFhirR4.AllergyIntolerance,
      sectionIdSuffix: 'allergies',
      displayClaimKey: 'AllergyIntolerance.code-display',
      displayValue: 'Penicillin allergy',
      displaySearchValue: 'penicillin',
      textClaimKey: 'AllergyIntolerance.code-text',
      textValue: 'Penicillin intolerance reaction',
      textSearchValue: 'reaction',
      expectedCompositionId: 'comp-alg-1',
    },
    {
      title: 'Problem List / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:cond-001',
      sectionToken: HealthcareBasicSections.ProblemList.attributeValue,
      resourceType: ResourceTypesFhirR4.Condition,
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Type 2 diabetes mellitus',
      displaySearchValue: 'diabetes',
      textClaimKey: 'Condition.code-text',
      textValue: 'Chronic endocrine condition',
      textSearchValue: 'endocrine',
      expectedCompositionId: 'comp-cond-1',
    },
    {
      title: 'Results / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:result-observation-001',
      sectionToken: HealthcareBasicSections.Results.attributeValue,
      resourceType: ResourceTypesFhirR4.Observation,
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Hemoglobin [Mass/volume] in Blood',
      displaySearchValue: 'hemoglobin',
      textClaimKey: 'Observation.code-text',
      textValue: 'Blood lab observation',
      textSearchValue: 'lab',
      expectedCompositionId: 'comp-result-observation-1',
    },
    {
      title: 'Results / DiagnosticReport',
      subjectDid: 'did:web:api.acme.org:research-subject:result-report-001',
      sectionToken: HealthcareBasicSections.Results.attributeValue,
      resourceType: 'DiagnosticReport',
      sectionIdSuffix: 'diagnostic-reports',
      displayClaimKey: 'DiagnosticReport.code-display',
      displayValue: 'Chest radiology report',
      displaySearchValue: 'radiology',
      textClaimKey: 'DiagnosticReport.code-text',
      textValue: 'Thorax imaging diagnostic report',
      textSearchValue: 'imaging',
      expectedCompositionId: 'comp-result-report-1',
    },
    {
      title: 'Procedures / Procedure',
      subjectDid: 'did:web:api.acme.org:research-subject:proc-001',
      sectionToken: HealthcareBasicSections.Procedures.attributeValue,
      resourceType: 'Procedure',
      sectionIdSuffix: 'procedures',
      displayClaimKey: 'Procedure.code-display',
      displayValue: 'Appendectomy procedure',
      displaySearchValue: 'appendectomy',
      textClaimKey: 'Procedure.code-text',
      textValue: 'Appendix removal surgery',
      textSearchValue: 'removal',
      expectedCompositionId: 'comp-proc-1',
    },
    {
      title: 'Immunizations / Immunization',
      subjectDid: 'did:web:api.acme.org:research-subject:imm-001',
      sectionToken: HealthcareBasicSections.Immunizations.attributeValue,
      resourceType: ResourceTypesFhirR4.Immunization,
      sectionIdSuffix: 'immunizations',
      displayClaimKey: 'Immunization.code-display',
      displayValue: 'COVID-19 vaccine',
      displaySearchValue: 'covid',
      textClaimKey: 'Immunization.code-text',
      textValue: 'SARS-CoV-2 immunization event',
      textSearchValue: 'immunization',
      expectedCompositionId: 'comp-imm-1',
    },
    {
      title: 'Functional Status / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:func-001',
      sectionToken: HealthcareBasicSections.FunctionalStatus.attributeValue,
      resourceType: ResourceTypesFhirR4.Condition,
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Reduced mobility',
      displaySearchValue: 'mobility',
      textClaimKey: 'Condition.code-text',
      textValue: 'Functional limitation in ambulation',
      textSearchValue: 'ambulation',
      expectedCompositionId: 'comp-func-1',
    },
    {
      title: 'Plan of Care / CarePlan',
      subjectDid: 'did:web:api.acme.org:research-subject:care-001',
      sectionToken: HealthcareBasicSections.PlanOfCare.attributeValue,
      resourceType: 'CarePlan',
      sectionIdSuffix: 'care-plans',
      displayClaimKey: 'CarePlan.code-display',
      displayValue: 'Home monitoring care plan',
      displaySearchValue: 'monitoring',
      textClaimKey: 'CarePlan.code-text',
      textValue: 'Daily home care plan',
      textSearchValue: 'daily',
      expectedCompositionId: 'comp-care-1',
    },
    {
      title: 'Plan of Treatment / CarePlan',
      subjectDid: 'did:web:api.acme.org:research-subject:treatment-001',
      sectionToken: HealthcareBasicSections.PlanOfTreatment.attributeValue,
      resourceType: 'CarePlan',
      sectionIdSuffix: 'care-plans',
      displayClaimKey: 'CarePlan.code-display',
      displayValue: 'Treatment follow-up plan',
      displaySearchValue: 'follow-up',
      textClaimKey: 'CarePlan.code-text',
      textValue: 'Longitudinal treatment plan',
      textSearchValue: 'longitudinal',
      expectedCompositionId: 'comp-treatment-1',
    },
    {
      title: 'Social History / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:social-001',
      sectionToken: HealthcareBasicSections.SocialHistory.attributeValue,
      resourceType: ResourceTypesFhirR4.Observation,
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Tobacco smoking status',
      displaySearchValue: 'smoking',
      textClaimKey: 'Observation.code-text',
      textValue: 'Former smoker',
      textSearchValue: 'smoker',
      expectedCompositionId: 'comp-social-1',
    },
    {
      title: 'Vital Signs / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:vs-001',
      sectionToken: HealthcareBasicSections.VitalSigns.attributeValue,
      resourceType: ResourceTypesFhirR4.Observation,
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Blood pressure panel',
      displaySearchValue: 'pressure',
      textClaimKey: 'Observation.code-text',
      textValue: 'Tension arterial',
      textSearchValue: 'tension',
      expectedCompositionId: 'comp-vs-1',
    },
    {
      title: 'Advance Directives / Consent',
      subjectDid: 'did:web:api.acme.org:research-subject:consent-001',
      sectionToken: HealthcareBasicSections.AdvanceDirectives.attributeValue,
      resourceType: ResourceTypesFhirR4.Consent,
      sectionIdSuffix: 'consents',
      displayClaimKey: 'Consent.code-display',
      displayValue: 'Advance healthcare directive',
      displaySearchValue: 'directive',
      textClaimKey: 'Consent.code-text',
      textValue: 'Future care wishes',
      textSearchValue: 'wishes',
      expectedCompositionId: 'comp-consent-1',
    },
    {
      title: 'History of Past Illness / Condition',
      subjectDid: 'did:web:api.acme.org:research-subject:past-001',
      sectionToken: HealthcareBasicSections.HistoryOfPastIllness.attributeValue,
      resourceType: ResourceTypesFhirR4.Condition,
      sectionIdSuffix: 'conditions',
      displayClaimKey: 'Condition.code-display',
      displayValue: 'Asthma',
      displaySearchValue: 'asthma',
      textClaimKey: 'Condition.code-text',
      textValue: 'Respiratory chronic illness',
      textSearchValue: 'respiratory',
      expectedCompositionId: 'comp-past-1',
    },
    {
      title: 'Pregnancy History / Observation',
      subjectDid: 'did:web:api.acme.org:research-subject:preg-001',
      sectionToken: HealthcareSummarySections.PregnancyHistory.attributeValue,
      resourceType: ResourceTypesFhirR4.Observation,
      sectionIdSuffix: 'observations',
      displayClaimKey: 'Observation.code-display',
      displayValue: 'Pregnancy status',
      displaySearchValue: 'pregnancy',
      textClaimKey: 'Observation.code-text',
      textValue: 'Gravida and parity history',
      textSearchValue: 'gravida',
      expectedCompositionId: 'comp-preg-1',
    },
    {
      title: 'Goals and Preferences / Consent',
      subjectDid: 'did:web:api.acme.org:research-subject:goal-001',
      sectionToken: HealthcareSummarySections.GoalsAndPreferences.attributeValue,
      resourceType: ResourceTypesFhirR4.Consent,
      sectionIdSuffix: 'consents',
      displayClaimKey: 'Consent.code-display',
      displayValue: 'Goals of care preferences',
      displaySearchValue: 'preferences',
      textClaimKey: 'Consent.code-text',
      textValue: 'Goals of care discussion',
      textSearchValue: 'goals',
      expectedCompositionId: 'comp-goal-1',
    },
  ] as const;

  const searchableSectionCases = searchableSectionFixtures.flatMap((fixture) => ([
    {
      title: `${fixture.title} / code-display`,
      subjectDid: fixture.subjectDid,
      sectionToken: fixture.sectionToken,
      resourceType: fixture.resourceType,
      sectionIdSuffix: fixture.sectionIdSuffix,
      storedClaims: { [fixture.displayClaimKey]: fixture.displayValue },
      searchParameterName: `${fixture.resourceType}.code-display`,
      searchValue: fixture.displaySearchValue,
      expectedCompositionId: fixture.expectedCompositionId,
    },
    {
      title: `${fixture.title} / code-text`,
      subjectDid: fixture.subjectDid,
      sectionToken: fixture.sectionToken,
      resourceType: fixture.resourceType,
      sectionIdSuffix: fixture.sectionIdSuffix,
      storedClaims: { [fixture.textClaimKey]: fixture.textValue },
      searchParameterName: `${fixture.resourceType}.code-text`,
      searchValue: fixture.textSearchValue,
      expectedCompositionId: fixture.expectedCompositionId,
    },
  ]));

  it.each(searchableSectionCases)(
    'supports digitaltwin Composition/_search for $title',
    async ({
      subjectDid,
      sectionToken,
      resourceType,
      sectionIdSuffix,
      storedClaims,
      searchParameterName,
      searchValue,
      expectedCompositionId,
    }) => {
      const resourceSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', sectionIdSuffix);
      const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
      mockVaultRepository.getAllSections.mockResolvedValue([
        resourceSectionId,
        compositionSectionId,
      ] as any);
      mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
        if (sectionId === resourceSectionId) {
          return [
            {
              id: `resource-${expectedCompositionId}`,
              [`${resourceType}.subject`]: subjectDid,
              ...storedClaims,
              indexed: { attributes: [] },
            },
          ] as any;
        }
        if (sectionId === compositionSectionId) {
          return [
            {
              id: expectedCompositionId,
              [CompositionClaim.Subject]: subjectDid,
              [CompositionClaim.Section]: sectionToken,
              [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            },
          ] as any;
        }
        return [] as any;
      });

      const job = createJob({
        action: '_search',
        content: {
          ...(createJob().content as any),
          body: {
            resourceType: ResourceTypesFhirR4.Parameters,
            parameter: [
              { name: 'section', valueString: sectionToken },
              { name: searchParameterName, valueString: searchValue },
            ],
          } as any,
        } as any,
      });

      const response = await manager.process(job);
      const data = (response.body as any).data;
      expect(data[0].type).toBe(GatewayResponseEntryTypes.CompositionSearch);
      const matches = extractBundleSearchResources(response);
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(expectedCompositionId);
    },
  );

  it('exposes a ResearchSubject whose canonical Composition indexes the matching twin resources', async () => {
    const subjectDid = REGISTERED_TWIN_SUBJECT;
    const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([medicationSectionId, compositionSectionId] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === medicationSectionId) {
        return [{
          id: 'medication-research-subject-001',
          'MedicationStatement.subject': subjectDid,
          'MedicationStatement.code': 'RXNORM|161',
        }] as any;
      }
      if (sectionId === compositionSectionId) {
        return [{
          id: 'composition-research-subject-001',
          [CompositionClaim.Subject]: subjectDid,
          [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
          [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
        }] as any;
      }
      return [] as any;
    });

    const response = await twinManager.process(createJob({
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'MedicationStatement.code', valueString: 'RXNORM|161' },
          ],
        },
      } as any,
    }));

    const entry = (response.body as any).data[0];
    expect(entry.type).toBe(GatewayResponseEntryTypes.ResearchSubjectSearch);
    expect(extractBundleSearchResources(response)[0]).toMatchObject({
      resourceType: ResourceTypesFhirR4.ResearchSubject,
      'ResearchSubject.identifier': subjectDid,
      'ResearchSubject.status': 'candidate',
      composition: {
        resourceType: ResourceTypesFhirR4.Composition,
        id: 'composition-research-subject-001',
        [CompositionClaim.Subject]: subjectDid,
      },
    });
  });

  it('supports digitaltwin Composition/_search by section plus MedicationStatement code-display and code-text together', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:med-combo-001';
    const medicationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'medications');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      medicationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === medicationSectionId) {
        return [
          {
            id: 'med-combo-1',
            'MedicationStatement.subject': subjectDid,
            'MedicationStatement.code-display': 'Paracetamol 500 MG Oral Tablet',
            'MedicationStatement.code-text': 'Paracetamol 500mg cada 8 horas',
            'MedicationStatement.medication-text': 'Paracetamol 500mg cada 8 horas',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-med-combo-1',
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'MedicationStatement.code-display', valueString: 'paracetamol' },
            { name: 'MedicationStatement.code-text', valueString: 'paracetamol' },
          ],
        } as any,
      } as any,
    }));

    const matches = extractBundleSearchResources(response);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('comp-med-combo-1');
  });

  it('supports digitaltwin Composition/_search by section plus Observation code-display and code-text together', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:obs-combo-001';
    const observationSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'observations');
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    mockVaultRepository.getAllSections.mockResolvedValue([
      observationSectionId,
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === observationSectionId) {
        return [
          {
            id: 'obs-combo-1',
            'Observation.subject': subjectDid,
            'Observation.code-display': 'Blood pressure panel with all children optional',
            'Observation.code-text': 'Blood pressure',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-obs-combo-1',
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.VitalSigns.attributeValue,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'Observation.code-display', valueString: 'pressure' },
            { name: 'Observation.code-text', valueString: 'pressure' },
          ],
        } as any,
      } as any,
    }));

    const matches = extractBundleSearchResources(response);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('comp-obs-combo-1');
  });

  it('supports digitaltwin Composition/_search by section plus Composition.meta-tag for one researcher selection', async () => {
    const subjectDid = 'did:web:api.lab.org:research-subject:selection-tag-001';
    const compositionSectionId = getSubjectScopedSectionId(subjectDid, 'digitaltwin', 'composition');
    const selectionCompositionId = 'research-selection-01JZ4CV2G1X2M5Y8Y3V4W6Q7R8';
    const selectionTag = {
      id: 'Composition.meta.tag[0]',
      system: 'urn:research:tag:score',
      code: '10',
    };

    mockVaultRepository.getAllSections.mockResolvedValue([
      compositionSectionId,
    ] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === compositionSectionId) {
        return [
          {
            id: selectionCompositionId,
            'Composition.identifier': selectionCompositionId,
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            [CompositionClaim.Author]: OPERATIONAL_EMPLOYEE_DID,
            meta: { tag: [selectionTag] },
            tag: [selectionTag],
          },
          {
            id: `${selectionCompositionId}-another-employee`,
            'Composition.identifier': `${selectionCompositionId}-another-employee`,
            [CompositionClaim.Subject]: subjectDid,
            [CompositionClaim.Section]: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            [CompositionClaim.Type]: HealthcareBasicSections.PatientSummaryDocument.attributeValue,
            [CompositionClaim.Author]: `${OPERATIONAL_EMPLOYEE_DID}:another`,
            meta: { tag: [selectionTag] },
            tag: [selectionTag],
          },
        ] as any;
      }
      return [] as any;
    });

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        meta: { bearer: { jwt: { payload: { sub: OPERATIONAL_EMPLOYEE_DID } } } },
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'Composition.meta-tag', valueCoding: { system: 'urn:research:tag:score', code: '10' } },
          ],
        } as any,
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].type).toBe(GatewayResponseEntryTypes.CompositionSearch);
    const matches = extractBundleSearchResources(response);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe(selectionCompositionId);
    expect((matches[0].meta as any)?.tag?.[0]?.system).toBe('urn:research:tag:score');
    expect((matches[0].meta as any)?.tag?.[0]?.code).toBe('10');
  });
});
