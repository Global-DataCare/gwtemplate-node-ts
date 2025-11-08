// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/CustomerManager.test.ts

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import { v4 as uuidv4 } from 'uuid';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { CustomerManager } from '../../../managers/CustomerManager';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { JobRequest } from '../../../models/request';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';

import { CredentialManager } from '../../../managers/CredentialManager';
import { EntityConfig } from '../../../models/entity';
import { testTenant1IdentifierUrn } from '../../data/organization.data';
import { testCustomer1Uuid } from '../../data/customer.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IBlockchainAdapter } from '../../../adapters/IBlockchainAdapter';
import {
  testCreateCustomerJobRequestProfessionalOnboarding,
  testIndividualOnboardingBatchEntries,
} from '../../data/customer-onboarding.data';
import { BundleEntry, BundleEntryResponse, ErrorEntry } from '../../../models/bundle';


// Mock the uuidv4 function to return a predictable value for tests
jest.mock('uuid', () => ({
  v4: jest.fn(),
  validate: jest.fn(() => true), // Mock the validate function
}));

// Mock the jurisdiction mapping utility
jest.mock('../../../utils/jurisdiction', () => ({
    getJurisdictionGroup: (countryCode: string) => {
      if (['ES', 'FR', 'DE'].includes(countryCode.toUpperCase())) {
        return 'eu';
      }
      return 'global';
    },
  }));
  
describe('CustomerManager', () => {
  let customerManager: CustomerManager;
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

    customerManager = new CustomerManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockCredentialManager,
      mockBlockchainAdapter, // Add the new dependency
      'test-network'         // Add the network name
    );
    jest.clearAllMocks();

    mockKmsService.protectConfidentialData.mockImplementation(
      async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete (secureDoc as Partial<ConfidentialStorageDoc>).content;
        return secureDoc;
      },
    );
  });

  describe('Customer Onboarding', () => {
    
    it('HU 2 (Professional Onboarding): should aggregate a batch and create a single customer', async () => {
      // ARRANGE
      const job = testCreateCustomerJobRequestProfessionalOnboarding;
      mockTenantsCacheManager.getTenantIdentifierUrn.mockReturnValue(TENANT_URN);

      // ACT
      const response = await customerManager.process(job);

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
        fail('Expected a BundleEntry, got an ErrorEntry.');
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
        content: {
          ...testCreateCustomerJobRequestProfessionalOnboarding.content,
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
      
      (job.content.body!.data[0].meta!.claims as any)['org.schema.Service.category'] = 'health-care';
      
      mockTenantsCacheManager.getTenantIdentifierUrn.mockReturnValue(TENANT_URN);

      // ACT
      const response = await customerManager.process(job);

      // ASSERT
      // 1. Verify the generated ID was used for persistence
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const savedDoc = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const customerConfig = savedDoc.content as EntityConfig;
      expect(customerConfig.id).toBe(generatedUuid);

      // 2. Verify the generated identifier is in the response
      const responseEntry = response.body.data[0];
      if (!('resource' in responseEntry)) {
        fail('Expected a BundleEntry with a resource, but received an ErrorEntry.');
      }
      expect(responseEntry.response.status).toBe('201');
      expect(responseEntry.resource?.id).toBe(generatedUuid);
      const finalClaims = responseEntry.resource!.meta!.claims!;
      expect(finalClaims[ClaimsPersonSchemaorg.identifier]).toBe(`urn:uuid:${generatedUuid}`);
    });

    it('should return an error if batch entries have inconsistent identifiers', async () => {
        // ARRANGE
        const job = { ...testCreateCustomerJobRequestProfessionalOnboarding };
        (job.content.body!.data[1].meta!.claims as any)[ClaimsPersonSchemaorg.identifier] = 'urn:uuid:different-uuid';
        mockTenantsCacheManager.getTenantIdentifierUrn.mockReturnValue(TENANT_URN);

        // ACT
        const response = await customerManager.process(job);

        // ASSERT
        expect(mockVaultRepository.put).not.toHaveBeenCalled();
        const errorEntry = response.body.data[0] as ErrorEntry;
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Identifier inconsistency in batch');
    });
  });

  describe('Customer Discovery', () => {
    it('should batch queries and call the adapter once per channel', async () => {
      // ARRANGE
      const job: JobRequest = {
        sector: 'health-care',
        tenantId: 'acme',
        action: '_discovery',
        resourceType: 'Person',
        content: {
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
      mockTenantsCacheManager.getTenantIdentifierUrn.mockReturnValue(TENANT_URN);
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
      const response = await customerManager.process(job);

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
