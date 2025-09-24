// src/__tests__/unit/services/KmsService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { KmsService } from '../../../services/KmsService';
import { Content } from '../../../utils/content';
import { ICryptography } from '../../../crypto/interfaces/ICryptography';
import { MldsaPublicJwk, MlkemPublicJwk } from '../../../crypto/interfaces/Cryptography.types';
import { JWK } from '../../../models/jwk';
import { DataCompactJWT } from '../../../models/jwt';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';

// Mock the dependency
const mockCryptoService: jest.Mocked<ICryptography> = {
  generateKeyPairMlDsa: jest.fn(),
  generateKeyPairMlKem: jest.fn(),
  encryptJwe: jest.fn(),
  decryptJwe: jest.fn(),
  getRecipientKidsFromJwe: jest.fn(),
  signDataJws: jest.fn(),
  parseCompactJws: jest.fn(),
  encryptJweToCompact: jest.fn(),
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  encapsulate: jest.fn(),
  decapsulate: jest.fn(),
  signBytes: jest.fn(),
  verifyBytes: jest.fn(),
  verifyJws: jest.fn(),
  verifyDetachedJws: jest.fn(),
  jwsToCompact: jest.fn(),
  parseCompactJwe: jest.fn(),
};

describe('KmsService', () => {
  let kmsService: KmsService;

  // Define mock keys that will be returned by the crypto service
  const mockMldsaPublicKey: MldsaPublicJwk & { kid: string } = { kty: 'AKP', alg: 'ML-DSA-65', kid: 'mock-dsa-kid', pub: 'mock-dsa-pub-key' };
  const mockMlkemPublicKey: MlkemPublicJwk & { kid: string } = { kty: 'OKP', crv: 'ML-KEM-768', kid: 'mock-kem-kid', x: 'mock-kem-pub-key' };
  const mockMldsaSecretKey = new Uint8Array([1]);
  const mockMlkemSecretKey = new Uint8Array([2]);

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup default mock implementations
    mockCryptoService.generateKeyPairMlDsa.mockResolvedValue({ publicJWKey: mockMldsaPublicKey, secretKeyBytes: mockMldsaSecretKey });
    mockCryptoService.generateKeyPairMlKem.mockResolvedValue({ publicJWKey: mockMlkemPublicKey, secretKeyBytes: mockMlkemSecretKey });

    kmsService = new KmsService(mockCryptoService);
  });

  describe('provisionKeys', () => {
    it('should generate and store a full key set for an entity', async () => {
      const jwks = await kmsService.provisionKeys('tenant-123');
      
      expect(mockCryptoService.generateKeyPairMlDsa).toHaveBeenCalledTimes(1);
      expect(mockCryptoService.generateKeyPairMlKem).toHaveBeenCalledTimes(1);
      expect(jwks.keys).toHaveLength(2);
      expect(jwks.keys).toContainEqual(mockMldsaPublicKey);
      expect(jwks.keys).toContainEqual(mockMlkemPublicKey);
      // Also check that internal storage contains the keys
      const storedKeys = await kmsService.getPublicJwks('tenant-123');
      expect(storedKeys).toEqual(jwks);
    });
  });

  describe('init', () => {
    it('should provision keys for the "host" entity', async () => {
      // We spy on the method in the same class we are testing
      const provisionSpy = jest.spyOn(kmsService, 'provisionKeys');
      
      await kmsService.init();

      expect(provisionSpy).toHaveBeenCalledWith('host');
      expect(provisionSpy).toHaveBeenCalledTimes(1);

      // Verify the host keys are actually available
      const hostKeys = await kmsService.getPublicJwks('host');
      expect(hostKeys).toBeDefined();
      expect(hostKeys.keys).toHaveLength(2);

      provisionSpy.mockRestore();
    });
  });

  describe('decodeJobRequest', () => {
    it('should correctly decode a JWE message', async () => {
      // Arrange
      await kmsService.init(); // INITIALIZE THE SERVICE
      const message = 'compact-jwe-string';
      const mockKids = ['mock-kem-kid'];
      const mockDecryptedBytes = new Uint8Array([1, 2, 3]);
      const mockProtectedHeader = { enc: 'A256GCM' };
      const mockJws: DataCompactJWT = { protected: {}, payload: { thid: '123' }, signature: new Uint8Array() };

      // The key is for a recipient, not the host. Provision it separately.
      // Note: `init()` already provisions the 'host' key, which acts as the recipient key in this mock setup.
      // We'll reset the mock to ensure we can track the call for 'tenant-123' specifically.
      mockCryptoService.generateKeyPairMlKem.mockClear();
      await kmsService.provisionKeys('tenant-123'); 
      mockCryptoService.getRecipientKidsFromJwe.mockReturnValue(mockKids);
      mockCryptoService.decryptJwe.mockResolvedValue({ decryptedBytes: mockDecryptedBytes, protectedHeader: mockProtectedHeader });
      mockCryptoService.parseCompactJws.mockReturnValue(mockJws);

      // Act
      const jobRequest = await kmsService.decodeJobRequest(message);

      // Assert
      expect(mockCryptoService.getRecipientKidsFromJwe).toHaveBeenCalledWith(message);
      expect(mockCryptoService.decryptJwe).toHaveBeenCalledWith(message, expect.any(Object));
      expect(mockCryptoService.parseCompactJws).toHaveBeenCalledWith(Content.bytesToStringUTF8(mockDecryptedBytes));
      expect(jobRequest.input).toEqual(mockJws.payload);
      expect(jobRequest.meta?.jwe?.header).toEqual(mockProtectedHeader);
    });
  });

  describe('signWithManagedKey', () => {
    it('should sign a payload using the correct managed key', async () => {
      const payload = new Uint8Array([10, 20, 30]);
      const entityId = 'tenant-123';
      const mockJwsParts = { protected: 'protected', payload: 'payload', signature: 'sig' };
      mockCryptoService.signDataJws.mockResolvedValue(mockJwsParts);
      
      await kmsService.provisionKeys(entityId);
      
      const jws = await kmsService.signWithManagedKey(payload, entityId);

      expect(mockCryptoService.signDataJws).toHaveBeenCalledWith(
        { data: Content.bytesToRawBase64UrlSafe(payload) },
        { alg: mockMldsaPublicKey.alg, kid: mockMldsaPublicKey.kid },
        mockMldsaSecretKey
      );
      expect(jws.signatures[0].signature).toBe(mockJwsParts.signature);
    });
  });
  
  describe('encodeResponse', () => {
    it('should use encryptJweToCompact for a single recipient', async () => {
      const payload = { message: 'response' };
      const senderId = 'host';
      const recipientJwks: JWK[] = [mockMlkemPublicKey as JWK];
      const mockCompactJwe = 'compact.jwe.string';

      await kmsService.provisionKeys(senderId);
      mockCryptoService.encryptJweToCompact.mockResolvedValue(mockCompactJwe);

      const result = await kmsService.encodeResponse(payload, recipientJwks, senderId);

      expect(mockCryptoService.encryptJweToCompact).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ skid: 'mock-kem-kid' }),
        expect.any(Object),
        recipientJwks[0]
      );
      expect(result).toBe(mockCompactJwe);
    });

    it('should use encryptJwe and JSON.stringify for multiple recipients', async () => {
      const payload = { message: 'response' };
      const senderId = 'host';
      const recipientJwks: JWK[] = [mockMlkemPublicKey as JWK, { ...mockMlkemPublicKey, kid: 'rec2' }];
      const mockJweObject = { protected: 'p', recipients: [], iv: 'i', ciphertext: 'c', tag: 't' };

      await kmsService.provisionKeys(senderId);
      mockCryptoService.encryptJwe.mockResolvedValue(mockJweObject);

      const result = await kmsService.encodeResponse(payload, recipientJwks, senderId);

      expect(mockCryptoService.encryptJwe).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ skid: 'mock-kem-kid' }),
        expect.any(Object),
        recipientJwks
      );
      expect(result).toBe(JSON.stringify(mockJweObject));
    });
  });

  describe('Confidential Data Protection', () => {
    it('should protect and unprotect data', async () => {
      await kmsService.init(); // INITIALIZE THE SERVICE
      const entityId = 'tenant-123';
      const docContent = { sensitive: 'data' };
      const doc: ConfidentialStorageDoc = {
        id: 'doc-1', content: docContent, sequence: 0
      };
      const mockEncryptedData = { ciphertext: 'c', iv: 'i', tag: 't' };

      await kmsService.provisionKeys(entityId);

      mockCryptoService.encrypt.mockResolvedValue(mockEncryptedData);
      mockCryptoService.decrypt.mockResolvedValue(JSON.stringify(docContent));

      // Protect
      const protectedDoc = await kmsService.protectConfidentialData(doc, entityId);
      expect(mockCryptoService.encrypt).toHaveBeenCalledWith(JSON.stringify(docContent), expect.any(Uint8Array), entityId);
      // The implementation returns an object, not a string.
      expect(protectedDoc.jwe).toEqual(mockEncryptedData);
      expect(protectedDoc.content).toBeUndefined();

      // Unprotect
      const unprotectedContent = await kmsService.unprotectConfidentialData(protectedDoc, entityId);
      expect(mockCryptoService.decrypt).toHaveBeenCalledWith(mockEncryptedData, expect.any(Uint8Array), entityId);
      expect(unprotectedContent).toEqual(docContent);
    });
  });
});
