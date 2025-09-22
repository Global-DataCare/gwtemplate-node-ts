// src/crypto/dek-kek.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import crypto from 'crypto';
import { encryptWithKEK, decryptWithKEK } from './kms-internal';

export interface EncryptedData {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

export function generateDEK(): Uint8Array {
  return crypto.randomBytes(32);
}

export function encryptDataWithDEK(data: Uint8Array, dek: Uint8Array): EncryptedData {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

  const ciphertext = Buffer.concat([
    cipher.update(data),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv: new Uint8Array(iv),
    authTag: new Uint8Array(authTag)
  };
}

export function decryptDataWithDEK(
  encrypted: EncryptedData,
  dek: Uint8Array
): Uint8Array {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, encrypted.iv);
  decipher.setAuthTag(encrypted.authTag);

  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ]);

  return new Uint8Array(plaintext);
}

export function encryptDEKWithKEK(dek: Uint8Array): Uint8Array {
    const { iv, authTag, ciphertext } = encryptWithKEK(dek);
    return new Uint8Array(Buffer.concat([iv, authTag, ciphertext]));
}
  
export function decryptDEKWithKEK(encrypted: Uint8Array): Uint8Array {
    const ivLength = parseInt(process.env.GCM_IV_BYTES || '16', 10);
    const iv = encrypted.subarray(0, ivLength);
    const authTag = encrypted.subarray(ivLength, ivLength + 16);
    const ciphertext = encrypted.subarray(ivLength + 16);
  
    return decryptWithKEK({ iv, authTag, ciphertext });
}
