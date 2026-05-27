// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
/**
 * @fileoverview TDD coverage for indexed `RelatedPerson` persistence and search.
 *
 * @architecture 101
 * These tests lock the canonical-claims contract and prevent regressions back to
 * full section scans for actor lookup.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  ClaimsContextFhirRelatedPerson,
  FHIR_RELATED_PERSON_PATIENT_CLAIM,
} from 'gdc-common-utils-ts/models/fhir-related-person';
import {
  RELATED_PROFILE_SEARCH_PARAM_ACTOR_IDENTIFIER,
} from 'gdc-common-utils-ts/models/related-profile';
import { RelatedPersonManager } from '../../../managers/RelatedPersonManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';

describe('RelatedPersonManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    getAllSections: jest.fn(),
    query: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;
  const mockKmsService = {
    protectAttributesNameAndValue: jest.fn(),
  } as unknown as jest.Mocked<IKmsService>;

  const manager = new RelatedPersonManager(mockVaultRepository, mockKmsService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockKmsService.protectAttributesNameAndValue.mockImplementation(async (attributes: any[]) => (
      attributes.map((attribute) => ({
        name: attribute.name,
        value: String(attribute.value),
        type: attribute.type,
        unique: attribute.unique,
      }))
    ));
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
              [FHIR_RELATED_PERSON_PATIENT_CLAIM]: 'did:web:connector.example.com:animal:chip:z123',
              [ClaimsContextFhirRelatedPerson.Identifier]: 'urn:uuid:rel-001',
              [ClaimsContextFhirRelatedPerson.Relationship]: 'guardian',
              [ClaimsContextFhirRelatedPerson.Phone]: 'tel:+34600123456',
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
    expect(putArgs[1][0].indexed.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: ClaimsContextFhirRelatedPerson.Subject,
          value: 'did:web:connector.example.com:animal:chip:z123',
        }),
        expect.objectContaining({
          name: ClaimsContextFhirRelatedPerson.Phone,
          value: 'tel:+34600123456',
        }),
      ]),
    );
  });

  it('fails fast when job.action is missing', async () => {
    const job = createJob({ action: '' as any });
    await expect(manager.process(job)).rejects.toThrow('Missing jurisdiction, section, format, or action.');
  });

  it('supports indexed _search for related profiles by actor identifier', async () => {
    const job = createJob({
      action: '_search',
      content: {
        jti: 'jti-relatedperson-search-1',
        thid: 'thid-relatedperson-search-1',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Parameters',
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: RELATED_PROFILE_SEARCH_PARAM_ACTOR_IDENTIFIER, valueString: 'tel:+34600123456' },
          ],
        },
      } as any,
    });

    mockVaultRepository.getAllSections.mockResolvedValue([
      'individual_related-persons_subject-001',
      'individual_composition_subject-001',
    ] as any);
    mockVaultRepository.query.mockResolvedValue([
      {
        id: 'rel-001',
        '@context': 'org.hl7.fhir.api',
        [FHIR_RELATED_PERSON_PATIENT_CLAIM]: 'did:web:subject:001',
        [ClaimsContextFhirRelatedPerson.Identifier]: 'urn:uuid:rel-001',
        [ClaimsContextFhirRelatedPerson.Relationship]: 'controller',
        [ClaimsContextFhirRelatedPerson.Phone]: 'tel:+34600123456',
        [ClaimsContextFhirRelatedPerson.Name]: 'Jane Doe',
      },
    ] as any);

    const response = await manager.process(job);
    const resource = (response.body as any).data[0].resource;
    expect(resource.actorIdentifier).toBe('tel:+34600123456');
    expect(resource.total).toBe(1);
    expect(resource.data[0].isController).toBe(true);
    expect(resource.data[0].subjectId).toBe('did:web:subject:001');
    expect(mockVaultRepository.query).toHaveBeenCalledWith(
      'health-care_acme',
      expect.objectContaining({
        equals: {
          'indexed.attributes': expect.objectContaining({
            name: ClaimsContextFhirRelatedPerson.Phone,
            value: 'tel:+34600123456',
          }),
        },
      }),
    );
  });
});
