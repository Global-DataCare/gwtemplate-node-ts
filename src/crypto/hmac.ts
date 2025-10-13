// src/crypto/hmac.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { hmac } from '@noble/hashes/hmac.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { Content } from '../utils/content';

export async function computeHmacSha256(plaintext: string, hmacKeyBytes: Uint8Array): Promise<Uint8Array> {
    return await hmac(sha3_256, hmacKeyBytes, Content.stringToBytesUTF8(plaintext));
}

export async function computeHmacSha256Base64Url(plaintext: string, hmacKeyBytes: Uint8Array): Promise<string> {
    return  Content.bytesToRawBase64UrlSafe(await computeHmacSha256(plaintext, hmacKeyBytes));
}
