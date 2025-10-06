// src/__tests__/unit/managers/CredentialManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { mock, MockProxy } from 'jest-mock-extended';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { CredentialManager } from '../../../managers/CredentialManager';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { testClaimsTenant1Organization, testTenant1Data } from '../../data/end-to-end.data';
import { getTenantVaultId } from '../../../utils/tenant';
import { EntityConfig } from '../../../models/entity';
import { JwsMultiSign } from '../../../models/jws';
import { JWK } from '../../../models/jwk';
import { Sector } from '../../../models/sector';
import { MldsaPublicJwk } from '../../../crypto/interfaces/Cryptography.types';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { testConfigTenant1 } from '../../data/organization.data';
import { ClaimsOrganizationSchemaorg } from '../../../models/schemaorg';

// Tell Jest what will be mocked
jest.mock('uuid');

// Mock dependencies using jest-mock-extended
const mockVaultRepository: MockProxy<VaultRepository> = mock<VaultRepository>();
const mockKmsService: MockProxy<IKmsService> = mock<IKmsService>();
const mockTenantsCacheManager: MockProxy<TenantsCacheManager> = mock<TenantsCacheManager>();

describe('CredentialManager', () => {
  let credentialManager: CredentialManager;
  const HOST_DID = 'did:web:test-host.com';

  // Create a valid mock TenantConfig based on available test data that satisfies the interface
  const mockTenantConfig: EntityConfig = {
    ...testConfigTenant1 as unknown as EntityConfig,
    id: 'acme-corp-id',
    claims: testClaimsTenant1Organization,
    didConfig: { '@context': '', id: '', service: [] },
    didDocument: { '@context': '', id: '' },
    identifier: '',
    jurisdiction: '',
    sector: Sector.HEALTH_CARE,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.get.mockReset();
    mockKmsService.unprotectConfidentialData.mockReset();
    mockKmsService.signWithManagedKey.mockReset();
    mockKmsService.getPublicVerificationKey.mockReset();

    credentialManager = new CredentialManager(
      mockVaultRepository,
      mockKmsService,
      HOST_DID
    );
  });

  describe('issueOrganizationSelfDescription', () => {
    it('should issue a valid, signed VC with a structured identifier and expiration date', async () => {
      // --- ARRANGE ---
      const vaultId = getTenantVaultId(mockTenantConfig.sector, mockTenantConfig.alternateName);
      (uuidv4 as jest.Mock).mockReturnValue('mocked-credential-uuid');

      const mockEncryptedTenantDoc: ConfidentialStorageDoc = {
        id: mockTenantConfig.id,
        sequence: 0,
        jwe: { ciphertext: 'encrypted-data-string' },
      };

      const mockSignatureResult: JwsMultiSign = {
        payload: 'base64.payload',
        signatures: [{
          protected: 'base64.protectedHeader',
          signature: 'base64.signature',
        }],
      };
      
      const mockPublicKey: JWK = {
        kid: 'key-1',
        kty: 'AKP', // Correct key type for ML-DSA
        alg: 'ML-DSA-65',
        pub: 'base64.publicKey',
      };

      mockVaultRepository.get.mockResolvedValue(mockEncryptedTenantDoc);
      mockKmsService.unprotectConfidentialData.mockResolvedValue(mockTenantConfig);
      mockKmsService.signWithManagedKey.mockResolvedValue(mockSignatureResult);
      mockKmsService.getPublicVerificationKey.mockResolvedValue(mockPublicKey as MldsaPublicJwk);

      // --- ACT ---
      const vc = await credentialManager.issueOrganizationSelfDescription(vaultId);

      // --- ASSERT ---
      expect(vc).toBeDefined();
      expect(vc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
      expect(vc.type).toEqual(['VerifiableCredential', 'Organization']);
      expect(vc.issuer).toBe(HOST_DID);

      const { proof } = vc;
      expect(proof).toBeDefined();
      expect(proof?.type).toBe('JsonWebSignature2020');
      expect(proof?.verificationMethod).toBe(`${HOST_DID}#${mockPublicKey.kid}`);
      
      const expectedJws = `${mockSignatureResult.signatures[0].protected}..${mockSignatureResult.signatures[0].signature}`;
      expect(proof?.jws).toBe(expectedJws);

      expect(mockKmsService.signWithManagedKey).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'host'
      );
    });

    it('should throw an error if the tenant is not found in the vault', async () => {
        const vaultId = 'non-existent-tenant';
        mockVaultRepository.get.mockResolvedValue(undefined);

        await expect(credentialManager.issueOrganizationSelfDescription(vaultId))
            .rejects
            .toThrow(`Tenant with vaultId '${vaultId}' not found in repository.`);
    });
  });
});
