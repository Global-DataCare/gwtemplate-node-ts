// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CompositionManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  CompositionManager,
} from '../../../managers/CompositionManager';
import { TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from '../../../managers/TwinCompositionManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  COMPOSITION_BATCH_ENTRY_EXAMPLE,
  COMPOSITION_SEARCH_BUNDLE_EXAMPLE,
  COMPOSITION_SEARCH_PARAMETERS_EXAMPLE,
} from '../../../api-examples';
import { DataCollectionIds } from '../../../shared/data-collections';
import { HealthcareBasicSections, HealthcareSummarySections } from '../../../shared/healthcare-constants';

describe('CompositionManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getContainersInSection: jest.fn(),
    listContainersInSection: jest.fn(),
    getAllSections: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new CompositionManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getContainersInSection.mockResolvedValue([] as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
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
    resourceType: 'Composition',
    action: '_batch',
    content: {
      jti: 'jti-comp-1',
      thid: 'thid-comp-1',
      iss: 'did:web:clinic.example.com:employee:loader',
      aud: 'did:web:api.example.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          { ...COMPOSITION_BATCH_ENTRY_EXAMPLE },
        ],
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
      'did:web:connector.example.com:animal:chip:z123',
      'digitaltwin',
      'composition',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('animal-research_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('ignores OperationOutcome entries from preconversion payload', async () => {
    const job = createJob({
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          data: [
            {
              resource: {
                resourceType: 'OperationOutcome',
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
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_BUNDLE_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(data[0].resource.total).toBe(1);
    expect(data[0].resource.data).toHaveLength(1);
  });

  it('supports _search with FHIR Parameters format', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }, { id: 'comp-2' }] as any);
    const job = createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: COMPOSITION_SEARCH_PARAMETERS_EXAMPLE as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(data[0].resource.total).toBe(2);
    expect(data[0].resource.data).toHaveLength(2);
  });

  it('supports _search with POST wrapper entries carrying FHIR Parameters', async () => {
    mockVaultRepository.listContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
    const job = createJob({
      action: '_search',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              request: {
                method: 'POST',
                url: 'Bundle/_search',
              },
              resource: {
                resourceType: 'Parameters',
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
    expect(data[0].type).toBe('Composition-search-response-v1.0');
    expect(data[0].resource.total).toBe(1);
    expect(data[0].resource.data).toHaveLength(1);
  });

  it('supports Subject/$summary with FHIR Parameters format in supported sectors', async () => {
    const subjectDid = 'did:web:api.acme.org:individual:summary-subject-001';
    mockVaultRepository.getContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'individual', 'composition')) {
        return [
          {
            id: 'composition-summary-001',
            'Composition.identifier': 'composition-summary-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.date': '2026-06-01T10:00:00Z',
            'Composition.author': 'did:web:provider.example.org',
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
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
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.r4 materialization', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:twin-summary-r4-001';
    mockVaultRepository.listContainersInSection.mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getSubjectScopedSectionId(subjectDid, 'digitaltwin', DataCollectionIds.composition)) {
        return [
          {
            id: 'composition-twin-summary-001',
            'Composition.identifier': 'urn:uuid:composition-twin-summary-001',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.date': '2026-06-01T10:00:00Z',
            'Composition.author': 'did:web:provider.example.org',
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
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
            'MedicationStatement.CodeDisplay': 'Lisinopril 10 MG Oral Tablet',
            'MedicationStatement.CodeTextLocal': 'Lisinopril 10 mg',
          },
        ] as any;
      }
      return [] as any;
    });

    const job = createJob({
      sector: 'health-care',
      section: 'digitaltwin',
      format: 'org.hl7.fhir.r4',
      resourceType: 'ResearchSubject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(data[0].resource.resourceType).toBe('Bundle');
    expect(data[0].resource.type).toBe('document');
    expect(data[0].resource.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(data[0].resource.entry[0].resource.resourceType).toBe('Composition');
    expect(data[0].resource.entry.some((entry: any) => entry.resource?.resourceType === 'MedicationStatement')).toBe(true);
  });

  it('supports digitaltwin ResearchSubject/$summary with org.hl7.fhir.api claims-first materialization', async () => {
    const subjectDid = 'did:web:api.acme.org:research-subject:twin-summary-api-001';
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
            'org.hl7.fhir.r4.Composition.author': 'did:web:provider.example.org',
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
            'org.hl7.fhir.r4.Observation.code-text': 'Blood pressure systolic',
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
      resourceType: 'ResearchSubject',
      action: '$summary',
      content: {
        ...(createJob().content as any),
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'subject', valueString: subjectDid },
          ],
        } as any,
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    const bundle = data[0].resource;
    expect(data[0].type).toBe('Bundle-summary-response-v1.0');
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
    expect(bundle.entry[0].fullUrl).toMatch(/^urn:uuid:/);
    expect(bundle.entry[0].resource).toEqual(expect.objectContaining({
      resourceType: 'Composition',
      id: expect.any(String),
      meta: {
        claims: expect.objectContaining({
          'Composition.subject': subjectDid,
        }),
      },
    }));
    const nonCompositionEntry = bundle.entry.find((entry: any) => entry.resource?.resourceType === 'Observation');
    expect(nonCompositionEntry.resource).toEqual({
      resourceType: 'Observation',
      id: 'observation-twin-summary-api-001',
      meta: {
        claims: expect.objectContaining({
          'Observation.subject': subjectDid,
        }),
      },
    });
  });

  it('declares the searchable digital twin IPS section to resource map', () => {
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.HistoryOfMedicationUse.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.medications], resourceType: 'MedicationStatement' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.VitalSigns.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: 'Observation' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareBasicSections.AdvanceDirectives.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.consents], resourceType: 'Consent' },
    ]);
    expect(TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[HealthcareSummarySections.PregnancyHistory.attributeValue]).toEqual([
      { collectionIds: [DataCollectionIds.observations], resourceType: 'Observation' },
    ]);
  });

  const searchableSectionCases = [
    {
      title: 'History of Medication Use / MedicationStatement / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:med-001',
      sectionToken: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      resourceType: 'MedicationStatement',
      sectionIdSuffix: 'medications',
      storedClaims: { 'MedicationStatement.CodeDisplay': 'Paracetamol 500 MG Oral Tablet' },
      searchParameterName: 'MedicationStatement.code-display',
      searchValue: 'oral tablet',
      expectedCompositionId: 'comp-med-1',
    },
    {
      title: 'Allergies and Intolerances / AllergyIntolerance / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:alg-001',
      sectionToken: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      resourceType: 'AllergyIntolerance',
      sectionIdSuffix: 'allergies',
      storedClaims: { 'AllergyIntolerance.code-text': 'Penicillin allergy' },
      searchParameterName: 'AllergyIntolerance.code-text',
      searchValue: 'penicillin',
      expectedCompositionId: 'comp-alg-1',
    },
    {
      title: 'Problem List / Condition / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:cond-001',
      sectionToken: HealthcareBasicSections.ProblemList.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      storedClaims: { 'Condition.CodeDisplay': 'Type 2 diabetes mellitus' },
      searchParameterName: 'Condition.code-display',
      searchValue: 'diabetes',
      expectedCompositionId: 'comp-cond-1',
    },
    {
      title: 'Results / Observation / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:result-001',
      sectionToken: HealthcareBasicSections.Results.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      storedClaims: { 'Observation.CodeDisplay': 'Hemoglobin [Mass/volume] in Blood' },
      searchParameterName: 'Observation.code-display',
      searchValue: 'hemoglobin',
      expectedCompositionId: 'comp-result-1',
    },
    {
      title: 'Procedures / Procedure / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:proc-001',
      sectionToken: HealthcareBasicSections.Procedures.attributeValue,
      resourceType: 'Procedure',
      sectionIdSuffix: 'procedures',
      storedClaims: { 'Procedure.code-text': 'Appendectomy' },
      searchParameterName: 'Procedure.code-text',
      searchValue: 'append',
      expectedCompositionId: 'comp-proc-1',
    },
    {
      title: 'Immunizations / Immunization / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:imm-001',
      sectionToken: HealthcareBasicSections.Immunizations.attributeValue,
      resourceType: 'Immunization',
      sectionIdSuffix: 'immunizations',
      storedClaims: { 'Immunization.CodeDisplay': 'COVID-19 vaccine' },
      searchParameterName: 'Immunization.code-display',
      searchValue: 'covid',
      expectedCompositionId: 'comp-imm-1',
    },
    {
      title: 'Functional Status / Condition / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:func-001',
      sectionToken: HealthcareBasicSections.FunctionalStatus.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      storedClaims: { 'Condition.code-text': 'Reduced mobility' },
      searchParameterName: 'Condition.code-text',
      searchValue: 'mobility',
      expectedCompositionId: 'comp-func-1',
    },
    {
      title: 'Social History / Observation / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:social-001',
      sectionToken: HealthcareBasicSections.SocialHistory.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      storedClaims: { 'Observation.code-text': 'Former smoker' },
      searchParameterName: 'Observation.code-text',
      searchValue: 'smoker',
      expectedCompositionId: 'comp-social-1',
    },
    {
      title: 'Vital Signs / Observation / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:vs-001',
      sectionToken: HealthcareBasicSections.VitalSigns.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      storedClaims: { 'Observation.code-text': 'Tension arterial' },
      searchParameterName: 'Observation.code-text',
      searchValue: 'tension',
      expectedCompositionId: 'comp-vs-1',
    },
    {
      title: 'Advance Directives / Consent / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:consent-001',
      sectionToken: HealthcareBasicSections.AdvanceDirectives.attributeValue,
      resourceType: 'Consent',
      sectionIdSuffix: 'consents',
      storedClaims: { 'Consent.CodeDisplay': 'Advance healthcare directive' },
      searchParameterName: 'Consent.code-display',
      searchValue: 'directive',
      expectedCompositionId: 'comp-consent-1',
    },
    {
      title: 'History of Past Illness / Condition / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:past-001',
      sectionToken: HealthcareBasicSections.HistoryOfPastIllness.attributeValue,
      resourceType: 'Condition',
      sectionIdSuffix: 'conditions',
      storedClaims: { 'Condition.CodeDisplay': 'Asthma' },
      searchParameterName: 'Condition.code-display',
      searchValue: 'asthma',
      expectedCompositionId: 'comp-past-1',
    },
    {
      title: 'Pregnancy History / Observation / code-display',
      subjectDid: 'did:web:api.acme.org:research-subject:preg-001',
      sectionToken: HealthcareSummarySections.PregnancyHistory.attributeValue,
      resourceType: 'Observation',
      sectionIdSuffix: 'observations',
      storedClaims: { 'Observation.CodeDisplay': 'Pregnancy status' },
      searchParameterName: 'Observation.code-display',
      searchValue: 'pregnancy',
      expectedCompositionId: 'comp-preg-1',
    },
    {
      title: 'Plan of Care / CarePlan / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:care-001',
      sectionToken: HealthcareBasicSections.PlanOfCare.attributeValue,
      resourceType: 'CarePlan',
      sectionIdSuffix: 'care-plans',
      storedClaims: { 'CarePlan.code-text': 'Home monitoring plan' },
      searchParameterName: 'CarePlan.code-text',
      searchValue: 'monitoring',
      expectedCompositionId: 'comp-care-1',
    },
    {
      title: 'Goals and Preferences / Consent / code-text',
      subjectDid: 'did:web:api.acme.org:research-subject:goal-001',
      sectionToken: HealthcareSummarySections.GoalsAndPreferences.attributeValue,
      resourceType: 'Consent',
      sectionIdSuffix: 'consents',
      storedClaims: { 'Consent.code-text': 'Goals of care discussion' },
      searchParameterName: 'Consent.code-text',
      searchValue: 'goals',
      expectedCompositionId: 'comp-goal-1',
    },
  ] as const;

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
              'Composition.subject': subjectDid,
              'Composition.section': sectionToken,
              'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
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
            resourceType: 'Parameters',
            parameter: [
              { name: 'section', valueString: sectionToken },
              { name: searchParameterName, valueString: searchValue },
            ],
          } as any,
        } as any,
      });

      const response = await manager.process(job);
      const data = (response.body as any).data;
      expect(data[0].type).toBe('Composition-search-response-v1.0');
      expect(data[0].resource.total).toBe(1);
      expect(data[0].resource.data[0].id).toBe(expectedCompositionId);
    },
  );

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
            'MedicationStatement.CodeDisplay': 'Paracetamol 500 MG Oral Tablet',
            'MedicationStatement.CodeTextLocal': 'Paracetamol 500mg cada 8 horas',
            'MedicationStatement.medication-text': 'Paracetamol 500mg cada 8 horas',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-med-combo-1',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
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
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
            { name: 'MedicationStatement.code-display', valueString: 'paracetamol' },
            { name: 'MedicationStatement.code-text', valueString: 'paracetamol' },
          ],
        } as any,
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].resource.total).toBe(1);
    expect(data[0].resource.data[0].id).toBe('comp-med-combo-1');
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
            'Observation.CodeDisplay': 'Blood pressure panel with all children optional',
            'Observation.code-text': 'Blood pressure',
            indexed: { attributes: [] },
          },
        ] as any;
      }
      if (sectionId === compositionSectionId) {
        return [
          {
            id: 'comp-obs-combo-1',
            'Composition.subject': subjectDid,
            'Composition.section': HealthcareBasicSections.VitalSigns.attributeValue,
            'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
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
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: HealthcareBasicSections.VitalSigns.attributeValue },
            { name: 'Observation.code-display', valueString: 'pressure' },
            { name: 'Observation.code-text', valueString: 'pressure' },
          ],
        } as any,
      } as any,
    }));

    const data = (response.body as any).data;
    expect(data[0].resource.total).toBe(1);
    expect(data[0].resource.data[0].id).toBe('comp-obs-combo-1');
  });
});
