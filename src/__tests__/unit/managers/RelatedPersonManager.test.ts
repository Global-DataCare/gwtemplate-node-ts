// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/RelatedPersonManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { RelatedPersonManager } from '../../../managers/RelatedPersonManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('RelatedPersonManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new RelatedPersonManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
  });

  const createJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-relatedperson-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.api',
    resourceType: 'RelatedPerson',
    action: '_batch',
    content: {
      jti: 'jti-relatedperson-1',
      thid: 'thid-relatedperson-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'RelatedPerson',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
              'RelatedPerson.identifier': 'urn:uuid:rel-001',
              'RelatedPerson.relationship': 'guardian',
            },
          },
        }],
      },
    } as any,
    ...overrides,
  });

  it('stores RelatedPerson claims and returns polling location without resource id', async () => {
    const job = createJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.api/RelatedPerson/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/RelatedPerson\/[0-9a-f]{8,}/i);

    const expectedSectionId = getSubjectScopedSectionId(
      'did:web:connector.example.com:animal:chip:z123',
      'individual',
      'related-persons',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('fails fast when job.action is missing', async () => {
    const job = createJob({ action: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing jurisdiction, section, format, or action.');
  });
});

