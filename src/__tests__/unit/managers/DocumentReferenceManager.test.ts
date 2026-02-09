// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/DocumentReferenceManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DocumentReferenceManager } from '../../../managers/DocumentReferenceManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getIndividualSectionId } from '../../../utils/individual-sections';

describe('DocumentReferenceManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new DocumentReferenceManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
  });

  const createJob = (claims: Record<string, any>): JobRequest => ({
    id: 'job-docref-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.r4',
    resourceType: 'DocumentReference',
    action: '_batch',
    content: {
      jti: 'jti-1',
      thid: 'thid-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.r4.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{ type: 'DocumentReference', meta: { claims } }],
      } as any,
    } as any,
  });

  it('stores DocumentReference claims in per-subject section and returns 201', async () => {
    const subject = 'did:web:api.acme.org:individual:123';
    const job = createJob({
      '@context': 'org.hl7.fhir.r4',
      'DocumentReference.subject': subject,
      'DocumentReference.identifier': 'urn:uuid:docref-001',
      'DocumentReference.category': 'http://loinc.org|11502-2',
      'DocumentReference.content-attachment-type': 'application/pdf',
      'DocumentReference.content-attachment-data': 'JVBERi0xLjQKJ...',
    });

    const response = await manager.process(job);
    expect(response.body?.resourceType).toBe('Bundle');
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');

    const sectionId = getIndividualSectionId(subject, 'document-references');
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(sectionId);
  });

  it('returns 400 when DocumentReference.subject is missing', async () => {
    const job = createJob({
      '@context': 'org.hl7.fhir.r4',
      'DocumentReference.identifier': 'urn:uuid:docref-001',
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(data[0].response.outcome.issue[0].diagnostics).toContain('DocumentReference.subject');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });
});

