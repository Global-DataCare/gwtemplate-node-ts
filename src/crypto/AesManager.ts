// src/security/AesManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Content } from '../utils/content';
import { ProtectedDataAES } from '../models/aes';

/**
 * Manages AES-GCM encryption and decryption using Node.js's native crypto module.
 * This class handles the core cryptography and the base64url serialization required for JWE.
 */
export class AesManager {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_SIZE = 32; // 256-bit key
  private readonly IV_GENERATION_SIZE = 12; // 96-bit IV, recommended by NIST for GCM
  private readonly TAG_SIZE_BYTES = 16; // 128-bit authentication tag

  /**
   * Encrypts a plaintext string and returns the components as base64url strings.
   * @param plaintext The stringified data to encrypt (e.g. a stringified object or ASCII string from raw bytes)
   * @param cekBytes The 32-byte Content Encryption Key.
   * @param aad The Additional Authenticated Data string for integrity protection.
   * @returns A promise resolving to the JWE-compatible encrypted components.
   */
  async encrypt(plaintext: string, cekBytes: Uint8Array, aad: string): Promise<ProtectedDataAES> {
    if (cekBytes.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: a ${this.KEY_SIZE}-byte key is required.`);
    }

    const iv = randomBytes(this.IV_GENERATION_SIZE);
    const aadBytes = Content.stringToBytesUTF8(aad);

    const cipher = createCipheriv(this.ALGORITHM, cekBytes, iv, {
      authTagLength: this.TAG_SIZE_BYTES
    });

    cipher.setAAD(aadBytes);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: Content.bytesToRawBase64UrlSafe(ciphertext),
      iv: Content.bytesToRawBase64UrlSafe(iv),
      tag: Content.bytesToRawBase64UrlSafe(tag),
    };
  }

  /**
   * Decrypts JWE-compatible encrypted components back to a plaintext string.
   * @param encryptedData The object containing the base64url-encoded ciphertext, iv, and tag.
   * @param cekBytes The 32-byte Content Encryption Key.
   * @param aad The Additional Authenticated Data for integrity verification.
   * @returns A promise resolving to the decrypted plaintext string.
   */
  async decrypt(
    encryptedData: ProtectedDataAES,
    cekBytes: Uint8Array,
    aad: string
  ): Promise<string> {
    if (cekBytes.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: a ${this.KEY_SIZE}-byte key is required.`);
    }

    const ciphertextBytes = Content.base64ToBytes(encryptedData.ciphertext);
    const tagBytes = Content.base64ToBytes(encryptedData.tag);
    const ivBytes = Content.base64ToBytes(encryptedData.iv);
    const aadBytes = Content.stringToBytesUTF8(aad);

    const decipher = createDecipheriv(this.ALGORITHM, cekBytes, ivBytes, {
        authTagLength: this.TAG_SIZE_BYTES
    });
    
    decipher.setAuthTag(tagBytes);
    decipher.setAAD(aadBytes);

    const decryptedBytes = Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]);

    return Content.bytesToStringUTF8(decryptedBytes);
  }
}
