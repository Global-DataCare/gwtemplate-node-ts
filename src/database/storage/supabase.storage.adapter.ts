// src/database/storage/supabase.storage.adapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { IStorageAdapter, UploadResult } from './IStorageAdapter';

const SHA3_384_MULTIHASH_PREFIX = new Uint8Array([0x15, 0x30]); // 0x15: sha3-384, 0x30: 48-byte length

export interface SupabaseStorageAdapterOptions {
  url: string;
  serviceRoleKey: string;
  bucketName: string;
  publicBucket?: boolean;
  fetchImpl?: typeof fetch;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildPublicUrl(baseUrl: string, bucketName: string, objectPath: string): string {
  const encodedPath = objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${trimTrailingSlash(baseUrl)}/storage/v1/object/public/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

/**
 * Uploads files to Supabase Storage using the REST API.
 * This adapter assumes a public bucket so stored claims can keep a stable public URL.
 */
export class SupabaseStorageAdapter implements IStorageAdapter {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly bucketName: string;
  private readonly publicBucket: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SupabaseStorageAdapterOptions) {
    if (!options?.url) {
      throw new Error('Supabase URL must be provided.');
    }
    if (!options?.serviceRoleKey) {
      throw new Error('Supabase service role key must be provided.');
    }
    if (!options?.bucketName) {
      throw new Error('Supabase storage bucket name must be provided.');
    }
    this.baseUrl = trimTrailingSlash(options.url);
    this.serviceRoleKey = options.serviceRoleKey;
    this.bucketName = options.bucketName;
    this.publicBucket = options.publicBucket !== false;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult> {
    if (!this.publicBucket) {
      throw new Error('SupabaseStorageAdapter currently requires a public bucket to return a stable publicUrl.');
    }

    const digest = sha3_384(dataBytes);
    const multihashBytes = new Uint8Array(SHA3_384_MULTIHASH_PREFIX.length + digest.length);
    multihashBytes.set(SHA3_384_MULTIHASH_PREFIX);
    multihashBytes.set(digest, SHA3_384_MULTIHASH_PREFIX.length);
    const encodedMultiHash = encodeMultibase58btc(multihashBytes);
    const objectPath = encodedMultiHash;

    const response = await this.fetchImpl(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}/${encodeURIComponent(objectPath)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey,
          'content-type': contentType,
          'x-upsert': 'true',
        },
        body: Buffer.from(dataBytes),
      },
    );

    if (!response.ok) {
      let diagnostics = `${response.status} ${response.statusText}`.trim();
      try {
        const bodyText = await response.text();
        if (bodyText) diagnostics = `${diagnostics}: ${bodyText}`;
      } catch {
        // Ignore body parsing failures; status text is enough.
      }
      throw new Error(`Supabase upload failed: ${diagnostics}`);
    }

    return {
      publicUrl: buildPublicUrl(this.baseUrl, this.bucketName, objectPath),
      encodedMultiHash,
    };
  }
}
