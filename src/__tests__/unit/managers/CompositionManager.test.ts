// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CompositionManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { CompositionManager } from '../../../managers/CompositionManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import {
  COMPOSITION_BATCH_ENTRY_EXAMPLE,
  COMPOSITION_SEARCH_BUNDLE_EXAMPLE,
  COMPOSITION_SEARCH_PARAMETERS_EXAMPLE,
} from '../../../api-examples';

describe('CompositionManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getContainersInSection: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new CompositionManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getContainersInSection.mockResolvedValue([] as any);
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
    mockVaultRepository.getContainersInSection.mockResolvedValue([{ id: 'comp-1' }] as any);
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
    mockVaultRepository.getContainersInSection.mockResolvedValue([{ id: 'comp-1' }, { id: 'comp-2' }] as any);
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
});
