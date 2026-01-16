// src/__tests__/managers/AuthorizationManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { ITokenVerifier } from '../../auth/ITokenVerifier';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getTenantVaultId } from '../../utils/tenant';

// --- Mocks ---

const mockVaultRepository: jest.Mocked<IVaultRepository> = {
  get: jest.fn(),
  put: jest.fn(),
  // Other methods required by the interface
  createNewVault: jest.fn(), vaultExists: jest.fn(), getVaultConfig: jest.fn(),
  createNewSection: jest.fn(), updateSection: jest.fn(), getAllSections: jest.fn(),
  sectionExists: jest.fn(), getContainersListInSection: jest.fn(), getContainersInSection: jest.fn(),
  getHistory: jest.fn(), query: jest.fn(), delete: jest.fn(), purge: jest.fn(),
};

const mockTokenVerifier: jest.Mocked<ITokenVerifier> = {
  verify: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
    getPublicVerificationKey: jest.fn(),
    // Add other methods as needed, satisfying the interface
    init: jest.fn(), provisionKeys: jest.fn(), getPublicJwks: jest.fn(),
    getPublicEncryptionKey: jest.fn(), getHostPublicJwkSet: jest.fn(),
    decodeRequest: jest.fn(), signWithManagedKey: jest.fn(),
    signWithReconstructedKey: jest.fn(), encodeResponse: jest.fn(),
    createDetachedJws: jest.fn(),
    createCompactJws: jest.fn(),
    protectConfidentialData: jest.fn(), unprotectConfidentialData: jest.fn(),
    getHmacBase64Url: jest.fn(), protectAttributesNameAndValue: jest.fn(),
};

// A mock for the low-level crypto service, needed for signature verification
const mockCryptographyService: jest.Mocked<ICryptography> = {
    verifyJws: jest.fn(),
} as any;


// --- Tests ---

describe('AppAuthorizationManager', () => {
  let manager: AppAuthorizationManager;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new AppAuthorizationManager(
        mockVaultRepository, 
        mockTokenVerifier, 
        mockKmsService, 
        mockCryptographyService
    );
  });

  describe('verifyIdToken', () => {
    it('should return a valid result for a correct id_token', async () => {
      // Arrange
      const mockPayload = { sub: 'user-123', email: 'test@example.com' };
      mockTokenVerifier.verify.mockResolvedValue({ valid: true, payload: mockPayload });

      // Act
      const result = await manager.verifyIdToken('valid.id.token');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
    });

    it('should throw a ManagerError for an invalid id_token', async () => {
        // Arrange
        mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'Invalid signature' });
  
        // Act & Assert
        await expect(manager.verifyIdToken('invalid.id.token'))
            .rejects.toThrow('ID token is invalid: Invalid signature');
    });
  });
  
  describe('verifyAndConsumeActivationCode', () => {
    it('should return a valid license and mark it as active', async () => {
        // Arrange
        const activationCode = 'valid-code';
        const tenantId = 'acme';
        const vaultId = getTenantVaultId('health-care', tenantId);
        const mockLicense: DeviceLicense = {
          id: 'license-1', tenantId: tenantId, status: 'issued', plan: 'annual',
          orderId: 'order-123', userClass: 'employee', type: 'mobile',
          renewalCycle: '12m', reactivationEnabled: true, exp: now + 3600,
          activationCode,
        };
        const mockDoc: ConfidentialStorageDoc = { id: activationCode, status: mockLicense.status, sequence: 0, content: mockLicense };
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([mockDoc]);
  
        // Act
        const result = await manager.verifyAndConsumeActivationCode(activationCode, tenantId, 'health-care');
  
        // Assert
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.license.activationCode).toBe(activationCode);
        }
        expect(mockVaultRepository.query).toHaveBeenCalledWith(
          vaultId,
          expect.objectContaining({ sectionId: 'device-licenses' }),
        );
        
        // Verify it updated the license status to 'active'
        const [updatedVaultId, updatedDocs] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
        expect(updatedVaultId).toBe(vaultId);
        expect(updatedDocs[0].content.status).toBe('active');
        expect(updatedDocs[0].sequence).toBe(1);
      });

      it('should throw an error if activation code is not found', async () => {
        // Arrange
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.getContainersInSection.mockResolvedValue([]);
  
        // Act & Assert
        await expect(manager.verifyAndConsumeActivationCode('not-found', 'acme', 'health-care'))
            .rejects.toThrow('Activation code not found or invalid.');
      });

      it('should throw an error if activation code is already used', async () => {
        // Arrange
        const mockLicense: DeviceLicense = { 
          id: 'license-2', tenantId: 'acme', status: 'active', plan: 'annual',
          orderId: 'order-456', userClass: 'individual', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode: 'used-code',
        };
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([{ id: 'used-code', content: mockLicense, sequence: 0 }]);

        // Act & Assert
        await expect(manager.verifyAndConsumeActivationCode('used-code', 'acme', 'health-care'))
            .rejects.toThrow('License is not in an activatable state.');
      });
  });

  // Future tests for `verifyInitialAccessToken` will be added here
});
