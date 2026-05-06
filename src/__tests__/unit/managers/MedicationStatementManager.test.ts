import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { MedicationStatementManager } from '../../../managers/MedicationStatementManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('MedicationStatementManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new MedicationStatementManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
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
    resourceType: 'MedicationStatement',
    action: '_batch',
    content: {
      jti: 'jti-medication-1',
      thid: 'thid-medication-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'MedicationStatement',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              'MedicationStatement.subject': 'Organization/subject-001',
              'MedicationStatement.identifier': 'urn:uuid:med-001',
              'MedicationStatement.medication': 'Paracetamol',
              'MedicationStatement.status': 'active',
            },
          },
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
  });

  it('supports _search by subject-scoped section and claim filters', async () => {
    mockVaultRepository.query.mockResolvedValueOnce([{ id: 'med-001' }] as any);
    const job = createBatchJob({ action: '_search' });
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('200');
    expect(data[0].resource.total).toBe(1);
    expect(mockVaultRepository.query).toHaveBeenCalled();
  });
});

