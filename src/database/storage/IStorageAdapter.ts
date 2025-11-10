// src/database/storage/IStorageAdapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents the result of a successful file upload operation.
 */
export interface UploadResult {
  /**
   * The publicly accessible URL of the uploaded file.
   */
  publicUrl: string;

  /**
   * The deterministic, self-describing multihash of the file's content,
   * encoded into a multibase string (e.g., base58btc).
   * This serves as the canonical, content-addressed identifier for the file.
   * Example: "zQ3sh..."
   */
  encodedMultiHash: string;
}

/**
 * Defines the interface for a generic file storage adapter.
 * This abstraction allows the application to interact with different
 * cloud storage providers (like Google Cloud Storage, AWS S3) in a uniform way.
 */
export interface IStorageAdapter {
  /**
   * Calculates the identifier and uploads a file to the storage provider.
   * The file's identifier (and its path/name in the bucket) will be its
   * content-addressed multihash.
   *
   * @param dataBytes The binary content of the file to upload.
   * @param contentType The MIME type of the file (e.g., 'application/pdf').
   * @returns A promise that resolves to an UploadResult containing the public URL and the encoded multihash.
   * @throws An error if the upload fails.
   */
  upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult>;
}
