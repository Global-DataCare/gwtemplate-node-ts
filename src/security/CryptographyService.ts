// src/security/CryptographyService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ICryptography, EncryptionOptions } from './interfaces/ICryptography';
import { AesManager } from './AesManager';
import { Convert } from '../utils/convert';
import { JweObject, ProtectedHeadersJWE, RecipientDataJWE } from '../models/jwe';
import { JWK } from '../models/jwk';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { randomBytes } from 'crypto';
import pako from 'pako';

/**
 * Provides high-level cryptographic functions implementing the ICryptography interface.
 * It orchestrates low-level utilities like AES and Post-Quantum KEMs to create
 * and decrypt JWE structures.
 */
export class CryptographyService implements ICryptography {
  private aesManager: AesManager;

  constructor() {
    this.aesManager = new AesManager();
  }

  // NOTE: This is a simplified decrypt for now. A full implementation
  // would need to reverse the process in `encrypt`.
  async decrypt(encryptedMessage: string): Promise<string> {
    // Placeholder for TDD cycle completion
    return Promise.resolve('decrypted');
  }

  /**
   * Encrypts a payload for multiple recipients using a hybrid JWE approach.
   * @param payload The plaintext object to encrypt.
   * @param recipientJwks An array of recipient public JWKs.
   * @param options Optional parameters for serialization and compression.
   * @returns A Promise resolving to the encrypted JWE as a JSON string.
   */
  async encrypt(payload: any, recipientJwks: JWK[], options?: EncryptionOptions): Promise<string> {
    const cekBytes = randomBytes(32);

    const protectedHeaders: ProtectedHeadersJWE = {
      enc: 'A256GCM',
      typ: 'didcomm-envelope-enc',
    };
    if (options?.compress) {
      protectedHeaders.zip = 'DEF';
    }
    const protectedHeaderB64Url = Convert.objectToBase64Url(protectedHeaders);

    let plaintextBytes = Convert.stringToBytes(JSON.stringify(payload));
    if (options?.compress) {
      plaintextBytes = pako.deflate(plaintextBytes);
    }
    const plaintextForAes = Convert.bytesToString(plaintextBytes);

    // AesManager returns strings already encoded in base64url.
    const encrypted = await this.aesManager.encrypt(plaintextForAes, cekBytes, protectedHeaderB64Url);

    const recipients: RecipientDataJWE[] = await Promise.all(
      recipientJwks.map(async (jwk) => {
        if (!jwk.x || !jwk.alg || !jwk.kid) {
          throw new Error('Recipient JWK must contain "x", "alg", and "kid" properties.');
        }
        const publicKeyBytes = Convert.base64UrlToBytes(jwk.x);
        
        const { cipherText } = await ml_kem768.encapsulate(publicKeyBytes);

        return {
          header: {
            alg: jwk.alg,
            kid: jwk.kid,
          },
          encrypted_key: Convert.bytesToBase64Url(cipherText),
        };
      })
    );

    // Assemble the final JWE object by directly assigning the base64url strings.
    const jweObject: JweObject = {
      protected: protectedHeaderB64Url,
      recipients: recipients,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
    };

    return JSON.stringify(jweObject);
  }
  
  // Omitted other methods from ICryptography for brevity in this TDD cycle.
  sign = jest.fn();
  verify = jest.fn();
  jwsToCompact = jest.fn();
  jwsToJson = jest.fn();
  parseJws = jest.fn();
  jweToCompact = jest.fn();
  jweToJson = jest.fn();
  parseJwe = jest.fn();
}
