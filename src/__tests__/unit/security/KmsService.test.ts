// src/__tests__/unit/security/KmsService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { KmsService } from '../../../security/KmsService';
import { ICryptography } from '../../../security/interfaces/ICryptography';
import { JWK } from '../../../models/jwk';
import { DecodedDidcommMessage } from '../../../models/request';

// This mock now includes all methods from the ICryptography interface to satisfy TypeScript.
const mockCryptographyService: jest.Mocked<ICryptography> = {
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  sign: jest.fn(),
  verify: jest.fn(),
  jwsToCompact: jest.fn(),
  jwsToJson: jest.fn(),
  parseJws: jest.fn(),
  jweToCompact: jest.fn(),
  jweToJson: jest.fn(),
  parseJwe: jest.fn(),
};

describe('KmsService', () => {
  let kmsService: KmsService;

  beforeEach(() => {
    // Instantiate the service with its mocked dependency
    kmsService = new KmsService(mockCryptographyService);
    jest.clearAllMocks();
  });

  describe('decodeRequest', () => {
    it('should successfully decode a simple request payload', async () => {
      // --- Arrange ---
      const testPayload: DecodedDidcommMessage = {
        thid: 'test-thread-id-123',
        priority: 3,
        type: 'test-type',
        body: {
          data: [{ claims: { 'org.schema.Organization.legalName': 'Test Corp' } }]
        }
      };
      
      // The crypto service is expected to return a JSON string.
      mockCryptographyService.decrypt.mockResolvedValue(JSON.stringify(testPayload));

      // This is the raw encrypted message the service will receive.
      const encryptedMessage = 'encrypted.jwe.payload.string';

      // --- Act ---
      const decodedRequest = await kmsService.decodeRequest(encryptedMessage);

      // --- Assert ---
      // Verify that the core decrypt function was called with the message
      expect(mockCryptographyService.decrypt).toHaveBeenCalledTimes(1);
      expect(mockCryptographyService.decrypt).toHaveBeenCalledWith(encryptedMessage);

      // Verify that the decoded request has the correct structure and content
      expect(decodedRequest).toBeDefined();
      expect(decodedRequest.thid).toBe(testPayload.thid);
      expect(decodedRequest.priority).toBe(testPayload.priority);
      expect(decodedRequest.body).toEqual(testPayload.body);
    });

    it('should throw an error if the decoded payload is not valid JSON', async () => {
      // --- Arrange ---
      // Simulate the decryptor returning a malformed string
      mockCryptographyService.decrypt.mockResolvedValue('this-is-not-json');
      // --- Act & Assert ---
      // We expect the promise to be rejected with a JSON parsing error.
      await expect(kmsService.decodeRequest('any.payload'))
        .rejects
        .toThrow('Failed to parse decoded payload:');
    });

    it('should throw an error if the "thid" is missing from the payload', async () => {
      // --- Arrange ---
      const invalidPayload = { priority: 1, body: {} }; // Missing thid
      mockCryptographyService.decrypt.mockResolvedValue(JSON.stringify(invalidPayload));
      // --- Act & Assert ---
      await expect(kmsService.decodeRequest('any.payload'))
        .rejects
        .toThrow('Invalid payload: "thid" is a required property.');
    });
  });

  describe('encodeResponse', () => {
    it('should orchestrate encryption for multiple recipients', async () => {
      // --- Arrange ---
      const responsePayload = { data: { status: 'success' } };
      const recipientJwks: JWK[] = [{ kid: 'did:key:1' }, { kid: 'did:key:2' }];
      const options = { compress: true };
      const expectedEncryptedString = 'encrypted.jwe.string';

      mockCryptographyService.encrypt.mockResolvedValue(expectedEncryptedString);
      // --- Act ---
      const result = await kmsService.encodeResponse(responsePayload, recipientJwks, options);
      // --- Assert ---
      // We test that KmsService correctly passes ALL arguments to the crypto service.
      expect(mockCryptographyService.encrypt).toHaveBeenCalledTimes(1);
      expect(mockCryptographyService.encrypt).toHaveBeenCalledWith(responsePayload, recipientJwks, options);
      expect(result).toBe(expectedEncryptedString);
    });
  });
});

