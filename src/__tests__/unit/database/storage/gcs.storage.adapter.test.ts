// src/__tests__/unit/database/storage/gcs.storage.adapter.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { GcsStorageAdapter } from '../../../../database/storage/gcs.storage.adapter';
import { Storage } from '@google-cloud/storage';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from '../../../../utils/multibase58';

// Mock the entire @google-cloud/storage library
jest.mock('@google-cloud/storage');

// Get a reference to the mocked Storage class
const mockedStorage = Storage as jest.MockedClass<typeof Storage>;

describe('GcsStorageAdapter', () => {
  const testBucketName = 'test-bucket';
  const testPdfBytes = new Uint8Array(Buffer.from('dummy pdf content'));
  const testContentType = 'application/pdf';

  let mockFileSave: jest.Mock;
  let mockMakePublic: jest.Mock;
  let mockFile: jest.Mock;
  let mockBucket: jest.Mock;

  beforeEach(() => {
    // Clear mock history from any previous test runs
    jest.clearAllMocks();

    // Recreate mocks for each test to ensure complete isolation
    mockFileSave = jest.fn().mockResolvedValue(undefined);
    mockMakePublic = jest.fn().mockResolvedValue(undefined);
    mockFile = jest.fn().mockReturnValue({
      save: mockFileSave,
      makePublic: mockMakePublic,
      publicUrl: () => `https://storage.googleapis.com/${testBucketName}/mock-hash`,
    });
    mockBucket = jest.fn().mockReturnValue({
      file: mockFile,
    });
    
    // Set up the mock implementation for the Storage constructor to use our recreated mocks
    mockedStorage.mockImplementation(() => ({
      bucket: mockBucket,
    } as any));
  });

  it('should throw an error if bucket name is not provided', () => {
    expect(() => new GcsStorageAdapter('')).toThrow('GCS bucket name must be provided.');
  });

  it('should correctly calculate multihash and call GCS methods on upload', async () => {
    const adapter = new GcsStorageAdapter(testBucketName);
    const result = await adapter.upload(testPdfBytes, testContentType);

    // 1. Calculate the expected hash to verify the logic
    const digest = sha3_384(testPdfBytes);
    const prefix = new Uint8Array([0x15, 0x30]); // sha3-384
    const multihashBytes = new Uint8Array(prefix.length + digest.length);
    multihashBytes.set(prefix);
    multihashBytes.set(digest, prefix.length);
    const expectedHash = encodeMultibase58btc(multihashBytes);

    // 2. Verify the adapter returned the correct hash
    expect(result.encodedMultiHash).toBe(expectedHash);
    expect(result.publicUrl).toBe(`https://storage.googleapis.com/${testBucketName}/mock-hash`);

    // 3. Verify the GCS client was called correctly
    expect(mockBucket).toHaveBeenCalledWith(testBucketName);
    expect(mockFile).toHaveBeenCalledWith(expectedHash);
    expect(mockFileSave).toHaveBeenCalledWith(Buffer.from(testPdfBytes), {
      contentType: testContentType,
      resumable: false,
    });
  });

  it('should re-throw a specific error if GCS upload fails', async () => {
    // Arrange: Make the save method fail for this specific test
    const gcsError = new Error('GCS connection timed out');
    mockFileSave.mockRejectedValue(gcsError);

    const adapter = new GcsStorageAdapter(testBucketName);

    // Act & Assert
    await expect(adapter.upload(testPdfBytes, testContentType))
      .rejects
      .toThrow(`GCS upload failed: ${gcsError.message}`);
    
    // Ensure makePublic was not called in the failure case
    expect(mockMakePublic).not.toHaveBeenCalled();

    // Clean up the mock for subsequent tests
    mockFileSave.mockResolvedValue(undefined);
  });
});
