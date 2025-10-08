// src/__tests__/mocks/kms.mock.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../models/confidential-storage';

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
  decodeJobRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content-by-mock' } };
    delete secureDoc.content;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => {
    if (doc.jwe) {
      return { legalName: 'Mocked Decrypted Content' } as any;
    }
    return doc.content as any;
  }),
  getHostPublicJwkSet: jest.fn(async () => ({ keys: [] })),
};
