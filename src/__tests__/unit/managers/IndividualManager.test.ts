// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/IndividualManager.test.ts

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

import { CredentialManager } from '../../../managers/CredentialManager';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { testTenant1IdentifierUrn } from '../../data/organization.data';
import { testCustomer1Uuid } from '../../data/customer.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IBlockchainAdapter } from '../../../adapters/IBlockchainAdapter';
import {
  testCreateCustomerJobRequestProfessionalOnboarding,
  testIndividualOnboardingBatchEntries,
} from '../../data/customer-onboarding.data';
import { BundleEntry, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';


const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(() => true), // Mock the validate function
};

jest.unstable_mockModule('uuid', () => uuidMock);
const { IndividualManager } = await import('../../../managers/IndividualManager');
const { v4: uuidv4 } = await import('uuid');
  
describe('IndividualManager', () => {
  let individualManager: InstanceType<typeof IndividualManager>;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockKmsService: MockProxy<IKmsService>;
  let mockTenantsCacheManager: MockProxy<TenantsCacheManager>;
  let mockCredentialManager: MockProxy<CredentialManager>;
  let mockBlockchainAdapter: MockProxy<IBlockchainAdapter>;


  const TENANT_URN = testTenant1IdentifierUrn;

  beforeEach(() => {
    mockVaultRepository = mock<IVaultRepository>();
    mockKmsService = mock<IKmsService>();
    mockTenantsCacheManager = mock<TenantsCacheManager>();
    mockCredentialManager = mock<CredentialManager>();
    mockBlockchainAdapter = mock<IBlockchainAdapter>();

    individualManager = new IndividualManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockCredentialManager,
      mockBlockchainAdapter, // Add the new dependency
      'test-network'         // Add the network name
    );
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');

    mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});
    mockKmsService.protectAttributesNameAndValue.mockResolvedValue([]);

    mockKmsService.protectConfidentialData.mockImplementation(
      async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete (secureDoc as Partial<ConfidentialStorageDoc>).content;
        return secureDoc;
      },
    );
  });

  describe('Customer Onboarding', () => {
    
    beforeEach(() => {
        // Ensure job object has all required properties for each test in this suite
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).id = 'test-id';
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).status = JobStatus.DRAFT;
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).sequence = 0;
        (testCreateCustomerJobRequestProfessionalOnboarding as JobRequest).createdAtTimestamp = Date.now();
    });
    
    it('HU 2 (Professional Onboarding): should aggregate a batch and create a single customer', async () => {
      // ARRANGE
      const job = testCreateCustomerJobRequestProfessionalOnboarding;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify persistence
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const savedDoc = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const customerConfig = savedDoc.content as EntityConfig;
      expect(customerConfig.id).toBe(testCustomer1Uuid);
      expect((customerConfig.claims as any)[ClaimsPersonSchemaorg.identifierValue]).toBe((testIndividualOnboardingBatchEntries[1].meta.claims as any)[ClaimsPersonSchemaorg.identifierValue]);

      // 2. Verify response structure
      const responseEntry = response.body.data[0];
      if (!('resource' in responseEntry)) {
        throw new Error('Expected a BundleEntry, got an ErrorEntry.');
      }
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.id).toBe(testCustomer1Uuid);

      // 3. Verify aggregated claims in the response
      const personClaims = responseEntry.resource!.meta!.claims!;
      const serviceClaims = responseEntry.resource!.contained![0]!.meta!.claims!;
      
      expect(personClaims[ClaimsPersonSchemaorg.email]).toBe((testIndividualOnboardingBatchEntries[0].meta.claims as any)[ClaimsPersonSchemaorg.email]);
      expect(personClaims[ClaimsPersonSchemaorg.identifierValue]).toBe((testIndividualOnboardingBatchEntries[1].meta.claims as any)[ClaimsPersonSchemaorg.identifierValue]);
      expect(serviceClaims[ClaimsServiceSchemaorg.termsOfService]).toBe((testIndividualOnboardingBatchEntries[0].meta.claims as any)[ClaimsServiceSchemaorg.termsOfService]);
    });

    it('HU 1 (Self-Onboarding): should generate an identifier if none is provided', async () => {
      // ARRANGE
      const generatedUuid = 'a1b2c3d4-e5f6-4a3b-8c2d-1e9f0a8b7c6d';
      (uuidv4 as jest.Mock).mockReturnValue(generatedUuid);

      const job: JobRequest = {
        ...testCreateCustomerJobRequestProfessionalOnboarding,
        id: 'self-onboarding-job-id', // Add required properties
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        content: {
          ...(testCreateCustomerJobRequestProfessionalOnboarding.content as IDecodedDidcommPayload),
          jti: 'self-onboarding-jti',
          body: {
            data: [
              {
                meta: {
                  claims: {
                    [ClaimsPersonSchemaorg.email]: 'new.customer@example.com',
                  },
                },
                request: { method: 'POST', url: '/' },
                type: 'Customer-form-v1.0',
              },
            ],
          },
        },
      };
      
      (job.content!.body!.data[0].meta!.claims as any)['org.schema.Service.category'] = 'health-care';
      
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify the generated ID was used for persistence
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const savedDoc = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const customerConfig = savedDoc.content as EntityConfig;
      expect(customerConfig.id).toBe(generatedUuid);

      // 2. Verify the generated identifier is in the response
      const responseEntry = response.body.data[0];
      if (!('resource' in responseEntry)) {
        throw new Error('Expected a BundleEntry with a resource, but received an ErrorEntry.');
      }
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.id).toBe(generatedUuid);
      const finalClaims = responseEntry.resource!.meta!.claims!;
      expect(finalClaims[ClaimsPersonSchemaorg.identifier]).toBe(`urn:uuid:${generatedUuid}`);
    });

    it('should return an error if batch entries have inconsistent identifiers', async () => {
	        // ARRANGE
	        const job = JSON.parse(JSON.stringify(testCreateCustomerJobRequestProfessionalOnboarding)) as JobRequest;
	        (job.content!.body!.data[1].meta!.claims as any)[ClaimsPersonSchemaorg.identifier] = 'urn:uuid:different-uuid';
	        mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

        // ACT
        const response = await individualManager.process(job);

        // ASSERT
        expect(mockVaultRepository.put).not.toHaveBeenCalled();
        const errorEntry = response.body.data[0] as ErrorEntry;
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Identifier inconsistency in batch');
    });

    it('should return an Offer when customer licenses exist but none are available', async () => {
      const job = JSON.parse(JSON.stringify(testCreateCustomerJobRequestProfessionalOnboarding)) as JobRequest;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getTenantDid.mockResolvedValue('did:web:host.example.com');

      const issuedLicense: DeviceLicense = {
        id: 'lic-1',
        tenantId: 'acme',
        orderId: 'order-1',
        userClass: 'individual',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: issuedLicense.id, sequence: 0, content: issuedLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await individualManager.process(job);
      const entry = response.body.data[0] as any;
      expect(entry.type).toBe('Individual-license-offer-v1.0');
      expect(entry.meta?.claims?.[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });
  });

  describe('Customer Discovery', () => {
    it('should batch queries and call the adapter once per channel', async () => {
      // ARRANGE
      const job: JobRequest = {
        id: 'discovery-job-id',
        status: JobStatus.DRAFT,
        sequence: 0,
        createdAtTimestamp: Date.now(),
        sector: 'health-care',
        tenantId: 'acme',
        section: 'test-network',
        format: 'org.schema',
        action: '_discovery',
        resourceType: 'Person',
        content: {
          jti: 'discovery-jti',
          thid: 'thid-test-batch',
          iss: 'iss-test',
          aud: 'aud-test',
          type: 'api+json',
          body: {
            data: [
              // EU-based identifier
              {
                type: 'Person-discover-v1.0',
                meta: { claims: { [ClaimsPersonSchemaorg.identifierType]: 'NNES', [ClaimsPersonSchemaorg.identifierValue]: '12345678Z' } }
              },
              // Global identifier
              {
                type: 'Person-discover-v1.0',
                meta: { claims: { [ClaimsPersonSchemaorg.telephone]: '+15551234567' } }
              },
              // Another EU-based identifier to test grouping
              {
                type: 'Person-discover-v1.0',
                meta: { claims: { [ClaimsPersonSchemaorg.identifierType]: 'PPNFR', [ClaimsPersonSchemaorg.identifierValue]: '987654321' } }
              },
            ]
          }
        }
      };
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      // Mock the batch response
      mockBlockchainAdapter.discoverDidsByHashes.mockImplementation(async (hashes, channel) => {
        if (channel === 'health-care-eu') {
            return ['did:web:nnes-did', undefined]; // NNES found, PPN not found
        }
        if (channel === 'health-care-global') {
            return ['did:web:phone-did'];
        }
        return [];
      });

      // ACT
      const response = await individualManager.process(job);

      // ASSERT
      // 1. Verify adapter was called exactly once for each channel
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledTimes(2);

      // 2. Verify the EU channel call
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledWith(
        [expect.any(String), expect.any(String)], // An array of 2 hashes
        'health-care-eu',
        'discovery-person'
      );

      // 3. Verify the Global channel call
      expect(mockBlockchainAdapter.discoverDidsByHashes).toHaveBeenCalledWith(
        [expect.any(String)], // An array of 1 hash
        'health-care-global',
        'discovery-person'
      );
      
      // 4. Verify the final response structure and order
      expect(response.body.data.length).toBe(3);
      expect((response.body.data[0] as BundleEntryResponse).response?.status).toBe('200');
      expect((response.body.data[0] as BundleEntryResponse).response.location).toBe('did:web:nnes-did');
      expect((response.body.data[1] as BundleEntryResponse).response.status).toBe('200');
      expect((response.body.data[1] as BundleEntryResponse).response.location).toBe('did:web:phone-did');
      expect((response.body.data[2] as ErrorEntry).response.status).toBe('404');
    });
  });
});
