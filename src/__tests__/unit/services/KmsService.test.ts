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
  jweToCompact: jest.fn(),
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

  describe('decodeJobRequest', () => {
    it('should correctly decode a JWE message', async () => {
      // Arrange
      const message = 'compact-jwe-string';
      const mockKids = ['mock-kem-kid'];
      const mockDecryptedBytes = new Uint8Array([1, 2, 3]);
      const mockProtectedHeader = { enc: 'A256GCM' };
      const mockJws: DataCompactJWT = { protected: {}, payload: { thid: '123' }, signature: new Uint8Array() };

      await kmsService.provisionKeys('tenant-123'); // Ensure the key is in the KMS

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
    it('should encrypt a response for a single recipient and return a compact JWE', async () => {
      const payload = { message: 'response' };
      const senderId = 'host';
      const recipientJwks: JWK[] = [mockMlkemPublicKey as JWK];
      // FIX: The mock object must contain a recipient to be logical for compact serialization.
      const mockJweObject = { 
        protected: 'p', 
        recipients: [{ header: { alg: "some", kid: mockMlkemPublicKey.kid }, encrypted_key: 'e' }], 
        iv: 'i', 
        ciphertext: 'c', 
        tag: 't' 
      };
      const mockCompactJwe = 'p.e.i.c.t';

      await kmsService.provisionKeys(senderId);

      mockCryptoService.encryptJwe.mockResolvedValue(mockJweObject);
      mockCryptoService.jweToCompact.mockReturnValue(mockCompactJwe);

      const result = await kmsService.encodeResponse(payload, recipientJwks, senderId);

      expect(mockCryptoService.encryptJwe).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ skid: 'mock-kem-kid' }),
        expect.any(Object),
        recipientJwks
      );
      expect(mockCryptoService.jweToCompact).toHaveBeenCalledWith(mockJweObject);
      expect(result).toBe(mockCompactJwe);
    });
  });

  describe('Confidential Data Protection', () => {
    it('should protect and unprotect data', async () => {
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
