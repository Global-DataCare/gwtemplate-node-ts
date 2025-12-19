// src/__tests__/managers/TokenManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TokenManager } from '../../managers/TokenManager';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DidDocument } from '../../models/did';
import { JwsMultiSign } from '../../models/jws';
import { Content } from '../../utils/content';

// --- Mocks ---

const mockKmsService: jest.Mocked<IKmsService> = {
  signWithManagedKey: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  // Add other methods of IKmsService as jest.fn() to satisfy the interface
  init: jest.fn(), provisionKeys: jest.fn(), getPublicJwks: jest.fn(),
  getPublicEncryptionKey: jest.fn(), getHostPublicJwkSet: jest.fn(),
  decodeRequest: jest.fn(), signWithReconstructedKey: jest.fn(),
  createDetachedJws: jest.fn(),
  encodeResponse: jest.fn(), protectConfidentialData: jest.fn(),
  unprotectConfidentialData: jest.fn(), getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
    getDidDocument: jest.fn(),
} as any;


// --- Tests ---

describe('TokenManager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new TokenManager(mockKmsService, mockTenantsCacheManager);
  });

  describe('createInitialAccessToken', () => {
    it('should construct and sign a JWT with the correct claims', async () => {
      // Arrange
      const mockHostDid = 'did:web:testhost.com';
      const mockHostDidDoc: DidDocument = { id: mockHostDid, verificationMethod: [] } as any;
      const mockSignature: JwsMultiSign = {
        payload: '',
        signatures: [{ protected: 'mockProtectedHeader', signature: 'mockSignature' }]
      };
      
      mockTenantsCacheManager.getDidDocument.mockResolvedValue(mockHostDidDoc);
      mockKmsService.getPublicVerificationKey.mockResolvedValue({ kid: 'host-key-1' } as any);
      mockKmsService.signWithManagedKey.mockResolvedValue(mockSignature);

      const inputClaims = {
        sub: 'user-123',
        jti: 'tx-456',
        act_code: 'abc-123',
        tenant_id: 'acme',
      };
      const tokenLifetime = 60;

      // Act
      const token = await manager.createInitialAccessToken(inputClaims, tokenLifetime);

      // Assert
      expect(mockKmsService.signWithManagedKey).toHaveBeenCalledWith(expect.any(Uint8Array), 'host');
      expect(token).toContain('mockSignature');

      // Decode the payload to verify its contents
      const payloadB64 = token.split('.')[1];
      const decodedPayload = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(payloadB64)));
      
      expect(decodedPayload.iss).toBe(mockHostDid);
      expect(decodedPayload.sub).toBe('user-123');
      expect(decodedPayload.aud).toBe('urn:gateway:dcr');
      expect(decodedPayload.scope).toBe('dcr:register');
      expect(decodedPayload.exp).toBeCloseTo(Math.floor(Date.now() / 1000) + tokenLifetime, -1);
    });

    it('should throw an error if host DID cannot be resolved', async () => {
      // Arrange
      mockTenantsCacheManager.getDidDocument.mockResolvedValue(undefined);

      // Act & Assert
      await expect(manager.createInitialAccessToken({}, 60))
        .rejects.toThrow('Could not resolve host DID. System not properly configured.');
    });
  });
});
