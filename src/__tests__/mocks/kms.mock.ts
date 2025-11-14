// src/__tests__/mocks/kms.mock.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../models/confidential-storage';
import { Content } from '../../utils/content';

/**
 * Creates a complete, correctly-typed mock of the IKmsService for use in tests.
 * This ensures that all methods are mocked and generic types are handled,
 * preventing TypeScript errors and promoting test consistency.
 */
export const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
    // Simulates REAL behavior: removes .content and encodes it inside .jwe.ciphertext
    const { content, ...docWithoutContent } = doc;
    const simulatedJwe = {
      ciphertext: Content.objectToRawBase64UrlSafe(doc.content || {}),
    };
    return { ...docWithoutContent, jwe: simulatedJwe };
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc): Promise<any> => {
    // Simulates REAL behavior: decodes .jwe.ciphertext to get the content.
    if (!doc.jwe?.ciphertext) {
      throw new Error('MockKmsService: Cannot unprotect document with invalid simulated JWE.');
    }
    return Content.base64UrlSafeToJSON(doc.jwe.ciphertext as string);
  }),
  getHostPublicJwkSet: jest.fn(async () => ({ keys: [] })),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};
