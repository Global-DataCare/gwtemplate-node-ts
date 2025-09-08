// src/__tests__/unit/security/CryptographyService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// import { jest } from '@jest/globals';
import { CryptographyService } from '../../../security/CryptographyService';
import { AesManager, ProtectedDataAES } from '../../../security/AesManager';
// The module 'ml_kem768' is mocked, so we get our mock implementation instead of the real one.
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { JWK } from '../../../models/jwk';
import { Convert } from '../../../utils/convert';
import { randomBytes } from 'crypto';
import { JweObject } from '../../../models/jwe';

// We mock the modules that are dependencies of our service.
jest.mock('@noble/post-quantum/ml-kem');

// Cast the imported mock to the appropriate Jest Mocked type for type-safe mocking.
const mockMlKem768 = ml_kem768 as jest.Mocked<typeof ml_kem768>;

describe('CryptographyService', () => {
  let cryptographyService: CryptographyService;
  beforeEach(() => {
    jest.clearAllMocks();
    cryptographyService = new CryptographyService();
  });

  describe('encrypt', () => {
    it('should orchestrate AES encryption and Kyber key encapsulation', async () => {
      // --- 1. Arrange ---
      const payload = { message: 'secret data' };
      const recipientJwks: JWK[] = [
        { kty: 'LWE', alg: 'kyber-768-r3', kid: 'recipient-1', x: Convert.bytesToBase64Url(randomBytes(1184)) },
        { kty: 'LWE', alg: 'kyber-768-r3', kid: 'recipient-2', x: Convert.bytesToBase64Url(randomBytes(1184)) },
      ];

      // Spy on AesManager's prototype to mock the 'encrypt' method for any instance.
      // The method should return an object with base64url strings, as per its contract.
      const mockEncryptedComponents: ProtectedDataAES = {
        ciphertext: 'mock-ciphertext-base64url',
        iv: 'mock-iv-base64url',
        tag: 'mock-tag-base64url',
      };
      const aesEncryptSpy = jest.spyOn(AesManager.prototype, 'encrypt').mockResolvedValue(mockEncryptedComponents);

      // Mock Kyber encapsulation result for each recipient
      const mockEncapsulation1 = { cipherText: randomBytes(1088), sharedSecret: randomBytes(32) };
      const mockEncapsulation2 = { cipherText: randomBytes(1088), sharedSecret: randomBytes(32) };

      // Create a mock function with the correct signature and assign it.
      const encapsulateMock = jest.fn()
        .mockResolvedValueOnce(mockEncapsulation1)
        .mockResolvedValueOnce(mockEncapsulation2);
      mockMlKem768.encapsulate = encapsulateMock;

              // --- 2. Act ---
      const jweString = await cryptographyService.encrypt(payload, recipientJwks);
      const jweObject: JweObject = JSON.parse(jweString);

      // --- 3. Assert ---
      expect(aesEncryptSpy).toHaveBeenCalledTimes(1);
      expect(mockMlKem768.encapsulate).toHaveBeenCalledTimes(2);
      expect(mockMlKem768.encapsulate).toHaveBeenCalledWith(Convert.base64UrlToBytes(recipientJwks[0].x!));
      expect(mockMlKem768.encapsulate).toHaveBeenCalledWith(Convert.base64UrlToBytes(recipientJwks[1].x!));

      // The final JWE should have the correct structure, using the mocked AES strings
      expect(jweObject.iv).toBe(mockEncryptedComponents.iv);
      expect(jweObject.ciphertext).toBe(mockEncryptedComponents.ciphertext);
      expect(jweObject.tag).toBe(mockEncryptedComponents.tag);
      expect(jweObject.recipients).toHaveLength(2);
      expect(jweObject.recipients[0].header.kid).toBe('recipient-1');
      expect(jweObject.recipients[0].encrypted_key).toBe(Convert.bytesToBase64Url(mockEncapsulation1.cipherText));
    });
  });
  // We will add tests for 'decrypt' in the next TDD cycle
});

