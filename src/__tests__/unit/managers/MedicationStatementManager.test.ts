// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { GatewayRequestEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { MedicationStatementManager } from '../../../managers/MedicationStatementManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { getEnvSectionId } from '../../../utils/section-env';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { CompositionClaim, ConfidentialDocumentIndex } from 'gdc-common-utils-ts';
import {
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';

describe('MedicationStatementManager', () => {
  const storedRecords = new Map<string, any>();
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getAllSections: jest.fn(),
    listContainersInSection: jest.fn(),
    get: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new MedicationStatementManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    storedRecords.clear();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockImplementation(async (vaultId: string, items: any[], sectionId?: string) => {
      items.forEach((item) => storedRecords.set(`${vaultId}|${sectionId}|${item.id}`, item));
      return true;
    });
    mockVaultRepository.get.mockImplementation(async (vaultId: string, id: string, sectionId?: string) =>
      storedRecords.get(`${vaultId}|${sectionId}|${id}`));
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
  });

  const createBatchJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-medication-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.api',
    resourceType: ResourceTypesFhirR4.MedicationStatement,
    action: '_batch',
    content: {
      jti: 'jti-medication-1',
      thid: 'thid-medication-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [{
          type: ResourceTypesFhirR4.MedicationStatement,
          resource: { meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'MedicationStatement.subject': 'Organization/subject-001',
              'MedicationStatement.identifier': 'urn:uuid:med-001',
              'MedicationStatement.code-text': 'Paracetamol',
              'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
              'MedicationStatement.medication': 'Medication/medication-161',
              'MedicationStatement.adherence': 'http://hl7.org/fhir/CodeSystem/medication-statement-adherence|taking-as-directed',
              'MedicationStatement.status': 'active',
              [CompositionClaim.Author]: [
                EXAMPLE_PROVIDER_ORGANIZATION_DID,
                EXAMPLE_SUBJECT_DID,
              ].join(','),
            } } },
        }],
      },
    } as any,
    ...overrides,
  });

  it('stores MedicationStatement claims and returns polling location', async () => {
    const job = createBatchJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch-response',
    );

    const expectedSectionId = getSubjectScopedSectionId(
      'Organization/subject-001',
      'individual',
      'medications',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
    expect(putArgs[1][0].indexed.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.subject', value: 'Organization/subject-001' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code-text', value: 'Paracetamol' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code', value: 'http://www.nlm.nih.gov/research/umls/rxnorm|161' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.medication', value: 'Medication/medication-161' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.adherence', value: 'http://hl7.org/fhir/CodeSystem/medication-statement-adherence|taking-as-directed' }),
      expect.objectContaining({ name: ConfidentialDocumentIndex.Sector, value: job.sector }),
      expect.objectContaining({ name: CompositionClaim.Author, value: EXAMPLE_PROVIDER_ORGANIZATION_DID }),
      expect.objectContaining({ name: CompositionClaim.Author, value: EXAMPLE_SUBJECT_DID }),
    ]));
  });

  it('omits malformed FHIR claim keys, warns, and persists the valid claims in the same entry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = createBatchJob();
    const entryClaims = (job.content as any).body.entry[0].resource.meta.claims;
    entryClaims['MedicationStatement.CodeDisplay'] = 'Paracetamol';
    entryClaims['MedicationStatement.code_display'] = 'Paracetamol';

    const response = await manager.process(job);

    expect((response.body as any).data[0].response.status).toBe('201');
    const individualPut = (mockVaultRepository.put as any).mock.calls.find((args: any[]) =>
      args[2] === getSubjectScopedSectionId('Organization/subject-001', 'individual', 'medications'));
    expect(individualPut[1][0]).toEqual(expect.objectContaining({
      'org.hl7.fhir.api.MedicationStatement.status': 'active',
    }));
    expect(individualPut[1][0]).not.toHaveProperty('org.hl7.fhir.api.MedicationStatement.CodeDisplay');
    expect(individualPut[1][0]).not.toHaveProperty('org.hl7.fhir.api.MedicationStatement.code_display');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('supports _search by subject-scoped section and claim filters', async () => {
    mockVaultRepository.query.mockResolvedValueOnce([{ id: 'med-001' }] as any);
    const job = createBatchJob({ action: '_search' });
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('200');
    expect(extractBundleSearchResources(response)).toHaveLength(1);
    expect(mockVaultRepository.query).toHaveBeenCalled();
  });

  it('mirrors individual medication updates only after explicit secondary-use consent', async () => {
    mockVaultRepository.get.mockResolvedValueOnce({ status: 'enabled' } as any);
    const job = createBatchJob();
    await manager.process(job);

    expect(mockVaultRepository.put).toHaveBeenCalledTimes(3);
    const aliasPutArgs = (mockVaultRepository.put as any).mock.calls.find((args: any[]) =>
      String(args[2] || '').includes('digitaltwin_subject_aliases'));
    const twinSubjectId = aliasPutArgs?.[1]?.[0]?.twinSubjectId;
    const digitalTwinSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');
    const digitalTwinPutArgs = (mockVaultRepository.put as any).mock.calls.find((args: any[]) => args[2] === digitalTwinSectionId);
    expect(digitalTwinPutArgs[0]).toBe('health-care_acme');
    expect(digitalTwinPutArgs[2]).toBe(digitalTwinSectionId);
    const researchRecord = digitalTwinPutArgs[1][0];
    const subjectKey = Object.keys(researchRecord).find((key) => key.endsWith('MedicationStatement.subject'));
    expect(researchRecord[subjectKey as string]).toBe(twinSubjectId);
    expect(Object.keys(researchRecord).some((key) => key.endsWith('MedicationStatement.code-text'))).toBe(false);
  });

  it('does not search digital twin medications by free text', async () => {
    const job = createBatchJob({
      action: '_search',
      section: 'digitaltwin',
      content: {
        thid: 'thid-digitaltwin-search-001',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          data: [
            {
              type: GatewayRequestEntryTypes.MedicationStatementSearch,
              resource: { meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  'MedicationStatement.code-text': 'paracetamol',
                } } },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    expect(extractBundleSearchResources(response)).toEqual([]);
    expect(mockVaultRepository.getAllSections).not.toHaveBeenCalled();
  });

  it('searches digital twin medications across subjects by exact medication code', async () => {
    mockVaultRepository.getAllSections.mockResolvedValueOnce([
      getEnvSectionId('digitaltwin_medications_hash-a'),
    ] as any);
    mockVaultRepository.listContainersInSection.mockResolvedValueOnce([
      {
        id: 'med-a',
        'MedicationStatement.subject': 'did:web:example:subject:a',
        'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
        indexed: { attributes: [{ name: 'MedicationStatement.code', value: 'http://www.nlm.nih.gov/research/umls/rxnorm|161' }] },
      },
    ] as any);

    const job = createBatchJob({
      action: '_search',
      section: 'digitaltwin',
      content: {
        thid: 'thid-digitaltwin-search-code-001',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          data: [
            {
              type: GatewayRequestEntryTypes.MedicationStatementSearch,
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
                },
              },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('200');
    const matches = extractBundleSearchResources(response);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('med-a');
  });
});
