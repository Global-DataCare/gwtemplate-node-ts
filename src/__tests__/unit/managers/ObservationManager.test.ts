// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/ObservationManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ObservationManager } from '../../../managers/ObservationManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('ObservationManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new ObservationManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
  });

  const createJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-observation-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.api',
    resourceType: 'Observation',
    action: '_batch',
    content: {
      jti: 'jti-observation-1',
      thid: 'thid-observation-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'Observation',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              'Observation.subject': 'did:web:connector.example.com:animal:chip:z123',
              'Observation.identifier': 'urn:uuid:obs-001',
              'Observation.code': 'http://loinc.org|85354-9',
              'Observation.status': 'final',
            },
          },
        }],
      },
    } as any,
    ...overrides,
  });

  it('stores Observation claims and returns polling location without resource id', async () => {
    const job = createJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.api/Observation/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/Observation\/[0-9a-f]{8,}/i);

    const expectedSectionId = getSubjectScopedSectionId(
      'did:web:connector.example.com:animal:chip:z123',
      'individual',
      'observations',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
  });

  it('fails fast when job.format is missing', async () => {
    const job = createJob({ format: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing jurisdiction, section, format, or action.');
  });
});

