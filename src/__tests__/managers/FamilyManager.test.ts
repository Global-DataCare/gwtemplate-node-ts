// src/__tests__/managers/FamilyManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { mock, MockProxy } from 'jest-mock-extended';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { BundleJsonApi, BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { ILogger } from '../../loggers/ILogger';
import { FamilyManager } from '../../managers/FamilyManager';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { mockKmsService } from '../mocks/kms.mock';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const TENANT_ID = 'acme';
const SECTOR = Sector.HEALTH_CARE;
const COLLECTION_NAME = `${SECTOR}_${TENANT_ID}`;
const TENANT_DID = 'did:web:host.example.com';

/**
 * Base set of already-normalized claims (org.schema.<Resource>.<field>) that satisfy
 * the minimum required by FamilyManager.extractResources(): Organization + Service
 * (Person is optional for individual organizations).
 * `termsOfService` is an https URL so handleServiceAttachment skips file upload.
 */
const BASE_CLAIMS: Record<string, unknown> = {
  'org.schema.Service.category': SECTOR,
  'org.schema.Organization.addressCountry': 'ES',
  'org.schema.Organization.identifier.additionalType': 'UUID',
  'org.schema.Organization.identifierValue': randomUUID(),
  'org.schema.Organization.owner.email': 'parent@example.com',
  'org.schema.Organization.owner.telephone': '+34600000001',
  'org.schema.Organization.owner.identifier.value': 'parent@example.com',
  'org.schema.Organization.alternateName': 'Ana',
  'org.schema.Person.email': 'child@example.com',
  'org.schema.Person.identifier.additionalType': 'UUID',
  'org.schema.Person.identifier.value': randomUUID(),
  'org.schema.Person.telephone': '+34600000001',
  'org.schema.Person.alternateName': 'Ana',
  'org.schema.Service.identifier': 'did:web:provider.example.com',
  'org.schema.Service.serviceType': 'http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC',
  'org.schema.Service.termsOfService': 'https://example.com/terms',
};

function makeBatchJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_batch',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-registration-form-v1.0',
          meta: { claims: { ...BASE_CLAIMS, ...overrideClaims } },
        }],
      },
    },
  };
}

function makeSearchJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_search',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-search-v1.0',
          meta: {
            claims: {
              'org.schema.Organization.owner.telephone': '+34600000001',
              'org.schema.Organization.owner.email': 'parent@example.com',
              'org.schema.Organization.alternateName': 'Ana',
              'org.schema.Service.category': SECTOR,
              ...overrideClaims,
            },
          },
        }],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FamilyManager', () => {
  let manager: FamilyManager;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockStorageAdapter: MockProxy<IStorageAdapter>;
  let mockLogger: MockProxy<ILogger>;
  let mockTenantsCacheManager: jest.Mocked<Pick<TenantsCacheManager, 'getCollectionName' | 'getTenantDid'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVaultRepository = mock<IVaultRepository>();
    mockStorageAdapter = mock<IStorageAdapter>();
    mockLogger = mock<ILogger>();

    mockTenantsCacheManager = {
      getCollectionName: jest.fn().mockResolvedValue(COLLECTION_NAME),
      getTenantDid: jest.fn().mockResolvedValue(TENANT_DID),
    };

    manager = new FamilyManager(
      mockVaultRepository,
      mockKmsService as any,
      mockTenantsCacheManager as unknown as TenantsCacheManager,
      mockStorageAdapter as any,
      mockLogger as any,
      { allowedPaymentMethods: ['Stripe'] } as any,
    );
  });

  // -------------------------------------------------------------------------
  // _batch — processFamilyRegistrationEntry
  // -------------------------------------------------------------------------

  describe('_batch / processFamilyRegistrationEntry', () => {
    it('new_created: stores doc and returns status new_created when vault has no match', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('new_created');
      expect(entry.response?.status).toBe('201');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    });

    it('already_exists: returns status already_exists without inserting when Active record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-active-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('resume_required: returns status resume_required without inserting when Pending record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Pending,
        claims: { ...BASE_CLAIMS },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-pending-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('idempotency query uses owner.telephone + alternateName as composite key', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      await manager.process(makeBatchJob());

      expect(mockVaultRepository.query).toHaveBeenCalledWith(
        COLLECTION_NAME,
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({ name: 'org.schema.Organization.owner.telephone', value: '+34600000001' }),
            expect.objectContaining({ name: 'org.schema.Organization.alternateName', value: 'Ana' }),
          ]),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // _search — processFamilySearchEntry
  // -------------------------------------------------------------------------

  describe('_search / processFamilySearchEntry', () => {
    it('not_found: returns not_found when no doc matches owner + alternateName', async () => {
      mockVaultRepository.query.mockResolvedValue([]);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('not_found');
    });

    it('already_exists: returns already_exists from _search when Active record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Active,
        claims: {
          'org.schema.Organization.owner.telephone': '+34600000001',
          'org.schema.Organization.alternateName': 'Ana',
        },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'active-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
    });

    it('resume_required: returns resume_required from _search when Pending record is found', async () => {
      const existingContent = {
        status: EntityLifecycleStatus.Pending,
        claims: {
          'org.schema.Organization.owner.telephone': '+34600000001',
          'org.schema.Organization.alternateName': 'Ana',
        },
        contained: [],
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'pending-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
    });
  });
});
