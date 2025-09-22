// src/security/interfaces/ICryptography.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { SignRequest, JWEData } from '../../crypto/interfaces/Cryptography.types';
import { JWK } from '../../models/jwk';
import { JwsMultiSign } from '../../models/jws';
/**
 * Defines options for JWE encryption.
 */
export interface EncryptionOptions {
  /**
   * If true, serialize the JWE using the Compact Serialization format.
   * This is only possible when there is exactly one recipient.
   */
  compact?: boolean;

  /**
   * If true, compress the plaintext payload using DEFLATE before encryption.
   * This sets the `zip` header in the JWE.
   */
  compress?: boolean;
}

/**
 * Defines the contract for a low-level cryptography utility.
// ... existing code ...
 */
export interface ICryptography {
  /**
   * Encrypts a plaintext payload for one or more recipients.
   * @param payload The plaintext object to encrypt.
   * @param recipientJwks An array of recipient public JWKs.
   * @param options Optional parameters for serialization and compression.
   * @returns A Promise resolving to the encrypted JWE as a JSON string.
   */
  encrypt(payload: any, recipientJwks: JWK[], options?: EncryptionOptions): Promise<string>;

  /**
   * Decrypts a JWE/JWS string.
   */
  decrypt(encryptedMessage: string): Promise<string>;

  sign(request: SignRequest): Promise<JwsMultiSign>;
  verify(jws: JwsMultiSign): Promise<{ verified: boolean; payload: Uint8Array }>;
  jwsToCompact(jws: JwsMultiSign): string;
  jwsToJson(jws: JwsMultiSign): string;
  parseJws(jwsString: string): JwsMultiSign;
  jweToCompact(jwe: JWEData): string;
  jweToJson(jwe: JWEData): string;
  parseJwe(jweString: string): JWEData;
}

