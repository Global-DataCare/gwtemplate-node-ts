// src/database/storage/gcs.storage.adapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Storage } from '@google-cloud/storage';
import { IStorageAdapter, UploadResult } from './IStorageAdapter';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from '../../utils/multibase58';

const SHA3_384_MULTIHASH_PREFIX = new Uint8Array([0x15, 0x30]); // 0x15: sha3-384, 0x30: 48-byte length

/**
 * An implementation of the IStorageAdapter for Google Cloud Storage.
 * It handles file uploads by using the file's content-addressed
 * multihash as its unique identifier in the GCS bucket.
 */
export class GcsStorageAdapter implements IStorageAdapter {
  private storage: Storage;
  private bucketName: string;

  /**
   * @param bucketName The name of the GCS bucket to use for storage.
   * @param gcsClient (Optional) An instance of the GCS Storage client. If not provided,
   * it will be instantiated automatically, relying on Application Default Credentials.
   */
  constructor(bucketName: string, gcsClient?: Storage) {
    if (!bucketName) {
      throw new Error('GCS bucket name must be provided.');
    }
    this.storage = gcsClient || new Storage();
    this.bucketName = bucketName;
  }

  /**
   * Uploads a file to GCS. The object name in the bucket will be the
   * multibase58btc encoded SHA3-384 multihash of the file's content.
   *
   * @param dataBytes The binary content of the file.
   * @param contentType The MIME type of the file.
   * @returns A promise that resolves to an UploadResult.
   */
  async upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult> {
    try {
      // 1. Calculate the SHA3-384 digest of the content.
      const digest = sha3_384(dataBytes);

      // 2. Construct the full multihash by prepending the prefix.
      const multihashBytes = new Uint8Array(SHA3_384_MULTIHASH_PREFIX.length + digest.length);
      multihashBytes.set(SHA3_384_MULTIHASH_PREFIX);
      multihashBytes.set(digest, SHA3_384_MULTIHASH_PREFIX.length);

      // 3. Encode the multihash using the project's utility to get the final identifier.
      const encodedMultiHash = encodeMultibase58btc(multihashBytes);

      // 4. Get a reference to the GCS file object.
      const file = this.storage.bucket(this.bucketName).file(encodedMultiHash);

      // 6. Upload the data. The GCS client library expects a Buffer.
      await file.save(Buffer.from(dataBytes), {
        contentType: contentType,
        resumable: false, // Use simple upload for smaller files.
      });

      // 7. Return the result. The public URL is generated automatically.
      return {
        publicUrl: file.publicUrl(),
        encodedMultiHash: encodedMultiHash,
      };
    } catch (error) {
      console.error(`[GcsStorageAdapter] Failed to upload to bucket '${this.bucketName}'.`, error);
      // Re-throw a more specific error for the manager layer to handle.
      throw new Error(`GCS upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
