// src/__tests__/mocks/kms.mock.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { IKmsService } from '../../security/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../models/confidential-storage';

/**
 * Creates a complete, correctly-typed mock of the IKmsService for use in tests.
 * This ensures that all methods are mocked and generic types are handled,
 * preventing TypeScript errors and promoting test consistency.
 */
export const mockKmsService: jest.Mocked<IKmsService> = {
  decodeRequest: jest.fn(),
  encodeResponse: jest.fn(),
  protectDocument: jest.fn(async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
    // Simulate the KMS encrypting the content and moving it to the JWE property.
    // This is a realistic simulation of the actual KmsService's behavior.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content-by-mock' } };
    delete secureDoc.content;
    return secureDoc;
  }),
  unprotectDocument: jest.fn(async (doc: ConfidentialStorageDoc) => {
    // Simulate the KMS decrypting the JWE and returning the content.
    if (doc.jwe) {
      return { legalName: 'Mocked Decrypted Content' } as any;
    }
    return doc.content as any;
  }),
  getDidDocument: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  sign: jest.fn(),
  verify: jest.fn(),
};
