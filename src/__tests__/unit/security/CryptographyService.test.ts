// src/__tests__/unit/security/CryptographyService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomBytes } from 'crypto';
import { KEM } from '@noble/post-quantum/utils';
import { ml_kem768 as noble_ml_kem768 } from '@noble/post-quantum/ml-kem';
import { CryptographyService } from '../../../security/CryptographyService';
import { AesManager } from '../../../security/AesManager';
import { Convert } from '../../../utils/convert';
import { JWK } from '../../../models/jwk';
import { JweObject } from '../../../models/jwe';

// Mock the dependencies of CryptographyService
jest.mock('../../../security/AesManager');
jest.mock('@noble/post-quantum/ml-kem');

const mockMlKem768 = noble_ml_kem768 as jest.Mocked<KEM>;
describe('CryptographyService', () => {
  let cryptographyService: CryptographyService;
  let mockAesManager: jest.Mocked<AesManager>;

  beforeEach(() => {
    // Reset mocks and create a new instance for each test
    jest.clearAllMocks();
    cryptographyService = new CryptographyService();
    // We get the mock instance created by jest.mock()
    mockAesManager = new (AesManager as any)();
  });

  describe('encrypt', () => {
    it('should orchestrate AES content encryption and Kyber key encapsulation for multiple recipients', async () => {
      // --- 1. Arrange ---
      const payload = { message: 'secret data' };
      const recipientJwks: JWK[] = [
        { kty: 'LWE', alg: 'kyber-768-r3', kid: 'recipient-1', x: Convert.bytesToBase64Url(randomBytes(1184)) },
        { kty: 'LWE', alg: 'kyber-768-r3', kid: 'recipient-2', x: Convert.bytesToBase64Url(randomBytes(1184)) },
      ];

      // Mock AES encryption result
      const mockEncryptedComponents = {
        ciphertext: randomBytes(64),
        iv: randomBytes(12),
        tag: randomBytes(16),
      };
      (mockAesManager.encrypt as jest.Mock).mockResolvedValue(mockEncryptedComponents);

      // Mock Kyber encapsulation result for each recipient
      const mockEncapsulation1 = { cipherText: randomBytes(1088), sharedSecret: randomBytes(32) };
      const mockEncapsulation2 = { cipherText: randomBytes(1088), sharedSecret: randomBytes(32) };

      // Correctly type the mock implementation
      (mockMlKem768.encapsulate as jest.Mock)
        .mockResolvedValueOnce(mockEncapsulation1)
        .mockResolvedValueOnce(mockEncapsulation2);
      
      // --- 2. Act ---
      const jweString = await cryptographyService.encrypt(payload, recipientJwks);
      const jweObject: JweObject = JSON.parse(jweString);

      // --- 3. Assert ---
      // It should have called the AES manager to encrypt the payload with a generated CEK
      expect(mockAesManager.encrypt).toHaveBeenCalledTimes(1);
      expect(mockAesManager.encrypt).toHaveBeenCalledWith(JSON.stringify(payload), expect.any(Uint8Array), expect.any(String));

      // It should have called Kyber encapsulation for each recipient with their public key
      expect(mockMlKem768.encapsulate).toHaveBeenCalledTimes(2);
      expect(mockMlKem768.encapsulate).toHaveBeenCalledWith(Convert.base64UrlToBytes(recipientJwks[0].x!));
      expect(mockMlKem768.encapsulate).toHaveBeenCalledWith(Convert.base64UrlToBytes(recipientJwks[1].x!));

      // The final JWE should have the correct structure
      expect(jweObject.protected).toBeDefined();
      const protectedHeaders = Convert.base64UrlToObject(jweObject.protected);
      expect(protectedHeaders.enc).toBe('A256GCM');
      expect(protectedHeaders.typ).toBe('didcomm-envelope-enc');
      
      expect(jweObject.recipients).toHaveLength(2);
      expect(jweObject.recipients[0].header.kid).toBe('recipient-1');
      expect(jweObject.recipients[0].encrypted_key).toBe(Convert.bytesToBase64Url(mockEncapsulation1.cipherText));
      expect(jweObject.recipients[1].header.kid).toBe('recipient-2');
      expect(jweObject.recipients[1].encrypted_key).toBe(Convert.bytesToBase64Url(mockEncapsulation2.cipherText));

      // Assert that the JWE components match the mocked AES result
      expect(jweObject.iv).toBe(Convert.bytesToBase64Url(mockEncryptedComponents.iv));
      expect(jweObject.ciphertext).toBe(Convert.bytesToBase64Url(mockEncryptedComponents.ciphertext));
      expect(jweObject.tag).toBe(Convert.bytesToBase64Url(mockEncryptedComponents.tag));
    });
  });

  // We will add tests for 'decrypt' in the next TDD cycle
});

