// src/__tests__/e2e/storage/gcs.storage.adapter.e2e.spec.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { GcsStorageAdapter } from '../../../database/storage/gcs.storage.adapter';
import { Storage } from '@google-cloud/storage';

describe('GcsStorageAdapter (E2E)', () => {
  // This test suite will only run if the TEST_ENV is set to 'e2e' and the required GCS env vars are present.
  // It requires a real GCP project with a configured bucket and a service account with "Storage Object Admin" role.
  const bucketName = process.env.GCS_BUCKET_NAME;

  // If the bucket name is not configured, we cannot run the tests.
  if (!bucketName) {
    throw new Error('Skipping E2E tests for GCS: GCS_BUCKET_NAME is not set in .env.test');
  }

  const storage = new Storage();
  const adapter = new GcsStorageAdapter(bucketName, storage);
  const testFileContent = `test-file-content-${Date.now()}`;
  const testFileBytes = new Uint8Array(Buffer.from(testFileContent));
  let uploadedFileHash: string | null = null;

  afterAll(async () => {
    // Cleanup: Ensure the uploaded test file is deleted after the tests run.
    if (uploadedFileHash) {
      try {
        await storage.bucket(bucketName).file(uploadedFileHash).delete();
        console.log(`[E2E Test Cleanup] Successfully deleted test file: ${uploadedFileHash}`);
      } catch (error) {
        console.error(`[E2E Test Cleanup] FAILED to delete test file: ${uploadedFileHash}`, error);
      }
    }
  });

  it('should upload a file, make it public, and return the correct hash and URL', async () => {
    // Act
    const result = await adapter.upload(testFileBytes, 'text/plain');
    uploadedFileHash = result.encodedMultiHash; // Store for cleanup

    // Assert
    expect(result.encodedMultiHash).toBeDefined();
    expect(result.encodedMultiHash.startsWith('z')).toBe(true); // multibase base58btc prefix
    expect(result.publicUrl).toBe(`https://storage.googleapis.com/${bucketName}/${result.encodedMultiHash}`);

    // Verify the file actually exists in the bucket and is public.
    const file = storage.bucket(bucketName).file(result.encodedMultiHash);
    const [exists] = await file.exists();
    expect(exists).toBe(true);

    // Optional: Check public access by trying to fetch the metadata without authentication
    const [metadata] = await file.getMetadata();
    // In a simple "public" setting, anyone can read.
    // More complex setups might require checking specific IAM policies.
    // For this test, confirming existence is sufficient.
    expect(metadata.name).toBe(result.encodedMultiHash);
    expect(metadata.contentType).toBe('text/plain');
  }, 20000); // Increase timeout for real network operations
});
