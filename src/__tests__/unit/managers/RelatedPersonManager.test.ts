// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/RelatedPersonManager.test.ts
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { RelatedPersonManager } from '../../../managers/RelatedPersonManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import { InteroperableLifecycleStatuses } from 'gdc-common-utils-ts/utils/interoperable-resource-operation';
import {
  SearchResponseProfileEnvironment,
  SearchResponseProfiles,
} from '../../../utils/didcomm-response';

describe('RelatedPersonManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    listContainersInSection: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new RelatedPersonManager(mockVaultRepository);

  beforeEach(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.get.mockResolvedValue(undefined as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.listContainersInSection.mockResolvedValue([] as any);
  });

  afterEach(() => {
    delete process.env[SearchResponseProfileEnvironment.Variable];
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
    resourceType: ResourceTypesFhirR4.RelatedPerson,
    action: '_batch',
    content: {
      jti: 'jti-relatedperson-1',
      thid: 'thid-relatedperson-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [{
          type: ResourceTypesFhirR4.RelatedPerson,
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

  it('accepts canonical resource.meta.claims and stores inactive status for lifecycle-style updates', async () => {
    const job = createJob({
      content: {
        jti: 'jti-relatedperson-2',
        thid: 'thid-relatedperson-2',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [{
            type: ResourceTypesFhirR4.RelatedPerson,
            resource: {
              meta: {
                status: EntityLifecycleStatus.Inactive,
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
                  'RelatedPerson.identifier': 'urn:uuid:rel-002',
                  'RelatedPerson.relationship': 'guardian',
                },
              },
            },
          }],
        },
      } as any,
    });

    const response = await manager.process(job);
    expect((response.body as any).data[0].response.status).toBe('201');
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const stored = (mockVaultRepository.put as any).mock.calls[0][1][0];
    expect(stored.status).toBe(EntityLifecycleStatus.Inactive);
  });

  it('purges a disabled related person through the explicit _purge action', async () => {
    const job = createJob({
      action: '_purge',
      content: {
        jti: 'jti-relatedperson-3',
        thid: 'thid-relatedperson-3',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: 'batch',
          entry: [{
            type: ResourceTypesFhirR4.RelatedPerson,
            resource: {
              id: 'urn:uuid:rel-001',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
                  'RelatedPerson.identifier': 'urn:uuid:rel-001',
                  'RelatedPerson.relationship': 'guardian',
                },
              },
            },
          }],
        },
      } as any,
    });

    mockVaultRepository.get.mockResolvedValue({
      id: 'urn:uuid:rel-001',
      status: EntityLifecycleStatus.Inactive,
      meta: {},
      'RelatedPerson.identifier': 'urn:uuid:rel-001',
      'RelatedPerson.patient': 'did:web:connector.example.com:animal:chip:z123',
    } as any);

    const response = await manager.process(job);
    expect((response.body as any).data[0].response.status).toBe('200');
    const stored = (mockVaultRepository.put as any).mock.calls[0][1][0];
    expect(stored.status).toBe(InteroperableLifecycleStatuses.Purged);
    expect(stored['RelatedPerson.lifecycle-disposition']).toBeUndefined();
    expect(stored.meta.lifecycleDisposition).toBe('purged');
  });

  it('returns one primary Bundle resource per subject-scoped RelatedPerson search match', async () => {
    const sourceJob = createJob();
    const sourceClaims = (sourceJob.content as any).body.entry[0].meta.claims;
    const subject = sourceClaims['RelatedPerson.patient'];
    mockVaultRepository.listContainersInSection.mockResolvedValue([{
      id: 'urn:uuid:rel-001',
      status: EntityLifecycleStatus.Active,
      ...sourceClaims,
    }] as any);

    const response = await manager.process(createJob({
      action: '_search',
      content: {
        ...(sourceJob.content as any),
        body: {
          resourceType: ResourceTypesFhirR4.Parameters,
          parameter: [{ name: 'patient', valueString: subject }],
        },
      } as any,
    }));

    expect(mockVaultRepository.listContainersInSection).toHaveBeenCalledWith(
      'health-care_acme',
      getSubjectScopedSectionId(subject, 'individual', 'related-persons'),
    );
    expect((response.body as any).total).toBe(1);
    expect((response.body as any).data).toHaveLength(1);
    expect((response.body as any).data[0]).toMatchObject({
      type: GatewayResponseEntryTypes.RelatedPersonSearch,
      response: { status: String(HttpStatusCodes.Ok) },
      resource: {
        type: ResourceTypesFhirR4.RelatedPerson,
        resource: {
          resourceType: ResourceTypesFhirR4.RelatedPerson,
          id: 'urn:uuid:rel-001',
        },
      },
    });
    expect((response.body as any).data[0].resource.data).toBeUndefined();
  });

  it('rejects RelatedPerson search without an explicit subject or patient', async () => {
    const sourceJob = createJob();
    await expect(manager.process(createJob({
      action: '_search',
      content: {
        ...(sourceJob.content as any),
        body: { resourceType: ResourceTypesFhirR4.Parameters, parameter: [] },
      } as any,
    }))).rejects.toThrow('RelatedPerson search requires an explicit subject or patient.');
    expect(mockVaultRepository.listContainersInSection).not.toHaveBeenCalled();
  });
});
