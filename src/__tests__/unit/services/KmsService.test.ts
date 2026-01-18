// src/__tests__/unit/services/KmsService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { KmsService } from '../../../services/KmsService';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { MldsaPublicJwk, MlkemPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { JWK } from '../../../gdc-backend-utils-node/models/jwk';
import { DataCompactJWT } from 'gdc-common-utils-ts/models/jwt';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';

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

const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
  findTenantByDid: jest.fn(),
} as any;


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

    kmsService = new KmsService(mockCryptoService, mockTenantsCacheManager);
  });

  describe('provisionKeys', () => {
    it('should generate and store a full key set for an entity', async () => {
      const jwks = await kmsService.provisionKeys('tenant-123');
      
      expect(mockCryptoService.generateKeyPairMlDsa).toHaveBeenCalledTimes(1);
      expect(mockCryptoService.generateKeyPairMlKem).toHaveBeenCalledTimes(1);
      expect(jwks.keys).toHaveLength(3);
      expect(jwks.keys).toContainEqual(mockMldsaPublicKey);
      expect(jwks.keys).toContainEqual(mockMlkemPublicKey);
      expect(jwks.keys.find((key) => key.alg?.startsWith('ES'))).toBeDefined();
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
      expect(hostKeys.keys).toHaveLength(3);

      provisionSpy.mockRestore();
    });
  });

  describe('decodeRequest', () => {
    it('should decrypt a JWE and return the parsed JWS payload', async () => {
      // Arrange
      await kmsService.init(); 
      const message = 'compact-jwe-string';
      const mockHostKid = 'mock-kem-kid'; // KID of the host's encryption key
      const mockDecryptedBytes = Content.stringToBytesUTF8('protected.payload.signature');
      const mockProtectedHeader = { enc: 'A256GCM', skid: 'sender-key-id', cty: 'JWS' }; // No JWK
      const mockDecodedPayload = {
        thid: '123',
        iss: 'did:web:sender',
        aud: 'did:web:receiver',
        type: 'api+json',
        body: { data: [] },
      };
      const mockJws: DataCompactJWT = { 
        protected: { alg: 'ML-DSA-44', kid: 'sender-key-id' }, 
        payload: mockDecodedPayload as any, 
        signature: new Uint8Array() 
      };

      mockCryptoService.getRecipientKidsFromJwe.mockReturnValue([mockHostKid]);
      mockCryptoService.decryptJwe.mockResolvedValue({ decryptedBytes: mockDecryptedBytes, protectedHeader: mockProtectedHeader });
      mockCryptoService.parseCompactJws.mockReturnValue(mockJws);

      // Act
      const jobRequest = await kmsService.decodeRequest(message);

      // Assert
      expect(mockCryptoService.getRecipientKidsFromJwe).toHaveBeenCalledWith(message);
      // It should have found the managed 'host' key (with kid 'mock-kem-kid') to decrypt.
      expect(mockCryptoService.decryptJwe).toHaveBeenCalledWith(message, expect.objectContaining({ kid: mockHostKid }));
      expect(mockCryptoService.parseCompactJws).toHaveBeenCalledWith(Content.bytesToStringUTF8(mockDecryptedBytes));
      
      // The service's job is ONLY to decrypt and parse.
      expect(jobRequest.content).toBeDefined();
      const content = jobRequest.content!;
      expect(content.body).toEqual(mockDecodedPayload.body);
      expect(content.meta?.jwe?.header).toEqual(mockProtectedHeader);
      // It MUST NOT have resolved or added a JWK. This is the orchestrator's job.
      expect(content.meta?.jwe?.header?.jwk).toBeUndefined();
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
        id: 'doc-1', status: 'active', content: docContent, sequence: 0
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
