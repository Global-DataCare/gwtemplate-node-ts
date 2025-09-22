
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/crypto/interfaces/ICryptography.ts

import { JweObject } from '../../models/jwe';
import { ProtectedDataAES } from '../../models/aes';
import { MlkemPublicJwk, MldsaPublicJwk, PublicJwk, MlkemPrivateJwk, MldsaAlg, MlkemCurve } from './Cryptography.types';
import { DataCompactJWT, JwtCompactParts } from '../../models/jwt';

/**
 * Defines the class for the low-level, stateless cryptography utility (the "Engine").
 */
export interface ICryptography {

  // --- Key Generation ---
  /**
   * Generates a ML-KEM (Kyber) key pair.
   * @param seedBytes Optional 64-byte seed for deterministic key generation.
   * @param crv The desired security level. Defaults to 'ML-KEM-768'.
   */
  generateKeyPairMlKem(seedBytes?: Uint8Array, crv?: MlkemCurve): Promise<{ publicJWKey: MlkemPublicJwk & { kid: string }; secretKeyBytes: Uint8Array }>;
  
  /**
   * Generates a ML-DSA (Dilithium) key pair.
   * @param seedBytes Optional 32-byte seed for deterministic key generation.
   * @param alg The desired security level. Defaults to 'ML-DSA-44'.
   */
  generateKeyPairMlDsa(seedBytes?: Uint8Array, alg?: MldsaAlg): Promise<{ publicJWKey: MldsaPublicJwk & { kid: string }; secretKeyBytes: Uint8Array }>;

  // --- Low-Level Primitives (Symmetric AES) ---
  /**
   * Encrypts a plaintext string using AES-GCM (a symmetric algorithm) and returns the components.
   * This is the core symmetric encryption primitive.
   * @param plaintext The stringified data to encrypt.
   * @param cekBytes The 32-byte Content Encryption Key (Symmetric Key).
   * @param aad The base64url-encoded 'JWE Protected Header', which serves as the 'Additional Authenticated Data' (AAD) for integrity verification.
   * @returns A promise resolving to the JWE-compatible encrypted components (ciphertext, iv, tag).
   */
  encrypt(plaintext: string, cekBytes: Uint8Array, aad: string): Promise<ProtectedDataAES>
    
  /**
   * Decrypts JWE-compatible encrypted components back to a plaintext string.
   * @param encryptedData The object containing the base64url-encoded ciphertext, iv, and tag.
   * @param cekBytes The 32-byte Content Encryption Key.
   * @param aad The base64url-encoded 'JWE Protected Header', which serves as the 'Additional Authenticated Data' (AAD) for integrity verification.
   * @returns A promise resolving to the decrypted plaintext string.
   */
  decrypt(
    encryptedData: ProtectedDataAES,
    cekBytes: Uint8Array,
    aad: string
  ): Promise<string>

  // --- Post-Quantum Computing ---
  
  /**
   * Generates and protects (encapsulates) a symmetric shared key (32 bytes)
   * @param dataBytes 
   * @param secretKeyBytes 
   * @param recipientPublicKeyBytes 
   */
  encapsulate(dataBytes: Uint8Array, secretKeyBytes: Uint8Array, recipientPublicKeyBytes: Uint8Array): Promise<{ encapsulatedBytes: Uint8Array; uncapsulatedBytes: Uint8Array; }>;
  
  /**
   * Returns the unprotected shared symmetric key
   * @param encapsulatedBytes 
   * @param secretKeyBytes 
   */
  decapsulate(encapsulatedBytes: Uint8Array, secretKeyBytes: Uint8Array): Promise<Uint8Array>;
  
  /**
   * Signs a byte array using a specified ML-DSA algorithm.
   * @param payloadBytes The raw data to sign.
   * @param secretKeyBytes The private signing key.
   * @param alg The ML-DSA algorithm to use (e.g., 'ML-DSA-44').
   * @returns A promise resolving to the raw signature bytes.
   */
  signBytes(payloadBytes: Uint8Array, secretKeyBytes: Uint8Array, alg: MldsaAlg): Promise<Uint8Array>; 
  
  /**
   * Verifies a signature against a byte array and a public key.
   * The algorithm is inferred from the `alg` property of the publicJWKey.
   * @param signatureBytes The raw signature to verify.
   * @param dataBytes The original data that was signed.
   * @param publicJWKey The public key to use for verification.
   * @returns A promise resolving to true if the signature is valid, false otherwise.
   */
  verifyBytes(signatureBytes: Uint8Array, dataBytes: Uint8Array, publicJWKey: PublicJwk): Promise<boolean>;  
  
  // --- High-Level Workflows ---

  /**
   * Encrypts a JSON payload into a JWE object.
   * @param payload JSON Object to encrypt.
   * @param protectedHeader JSON Header to protect.
   * @param secretJWKey The private key of the sender.
   * @param recipientsJWKeys Array of public keys for the recipients.
   * @param createRecipientHeaders If true (default), creates a header for each recipient. If false,
   *   omits the per-recipient header, making the output compatible with Compact Serialization if
   *   there is only one recipient.
   * @returns A promise resolving to the JWE Object.
   */
  encryptJwe(
    payload: object, 
    protectedHeader: object, 
    secretJWKey: MlkemPrivateJwk, 
    recipientsJWKeys: MlkemPublicJwk[], 
    createRecipientHeaders?: boolean
  ): Promise<JweObject>;  
  
  /**
   * Decrypts a JWE (in Compact or JSON format) and returns the decrypted bytes and protected header.
   * This method identifies the correct recipient using the `kid` from the provided private JWK.
   * @param jwe The JWE object or Compact JWE string.
   * @param secretKeyJwk The private key of the recipient, containing the `kid` to find the
   *   correct recipient and the `dBytes` for the decapsulation operation.
   * @returns A promise resolving to an object containing the decrypted bytes and the decoded protected header.
   */
  decryptJwe(
    jwe: JweObject | string,
    secretKeyJwk: MlkemPrivateJwk
  ): Promise<{ decryptedBytes: Uint8Array, protectedHeader: object }>;


  /**
   * @param jwe The JWE object or Compact/JSON JWE string.
   * @returns An array of strings, where each string is a recipient's `kid`. Returns an empty array if no kids are found.
   */
  getRecipientKidsFromJwe(jwe: JweObject | string): string[];  

  /**
   * Creates a JWS using the payload and header objects, and the signer's private key bytes.
   */
  signDataJws(payload: object, protectedHeader: object, secretJWKey: Uint8Array): Promise<JwtCompactParts>;

  /**
   * Verifies the signature of a JWS Object against the signer's public key (JWK).
   */
  verifyJws(jws: JwtCompactParts | string, publicJWKey: PublicJwk): Promise<boolean>;

  /**
   * Verifies a detached JWS signature against the original payload.
   * @param payloadBytes The original, unencoded byte stream that was signed.
   * @param detachedJws The JWS in detached format ('header..signature').
   * @param publicJWKey The signer's public key (JWK) to use for verification.
   * @returns A boolean indicating if the signature is valid.
   */
  verifyDetachedJws(payloadBytes: Uint8Array, detachedJws: string, publicJWKey: PublicJwk): Promise<boolean>;  
  
  // --- Formatting & Parsing Utilities (Note: from cryptoEncode, cryptoDecode, jwt utils ... ---

  /**
   * Converts a JWS Object (with decoded headers and payload) into Compact Serialization format.
   * @param jws The JWS Object to convert.
   * @returns The JWS in Compact Serialization format (three base64url strings joined by dots).
   */
  jwsToCompact(jws: DataCompactJWT): string;
  
  /**
   * Parses a JWS in Compact Serialization format into a JWS Object with decoded headers and payload.
   * @param jwsString The compact JWS string.
   * @returns A JWS Object with JSON objects for the header and payload.
   */
  parseCompactJws(jwsString: string): DataCompactJWT;

  /**
   * Converts a JWE Object into Compact Serialization format.
   * Throws an error if the JWE has more than one recipient or a shared unprotected header.
   * @param jwe The JWE Object to convert.
   * @returns The JWE in Compact Serialization format.
   */  
  jweToCompact(jwe: JweObject): string;
  
  /**
   * Parses a JWE in Compact Serialization format into a JWE Object.
   * @param jweString The compact JWE string.
   * @returns A JWE Object.
   */
  parseCompactJwe(jweString: string): JweObject;
}
