// src/crypto/CryptographyService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// Use `import * as pako` to ensure compatibility with CommonJS/ESM module resolution.
// This resolves a stubborn TypeScript error (`esModuleInterop`) during testing.

import { randomBytes } from 'crypto';
import * as pako from 'pako';
import * as mlDsa from '@noble/post-quantum/ml-dsa';
import * as mlKem from '@noble/post-quantum/ml-kem';
import * as jwtUtils from '../utils/jwt';
import { ICryptography } from './interfaces/ICryptography';
import { AesManager } from './AesManager';
import { Content } from '../utils/content';
import { withKid } from './jwk-thumbprint';
import { DataCompactJWT, JwtCompactParts } from '../models/jwt';
import { JweObject, ProtectedHeadersJWE, RecipientDataJWE } from '../models/jwe';
import { MlkemPublicJwk, MldsaPublicJwk, PublicJwk, MlkemPrivateJwk, MldsaAlg, MlkemCurve } from './interfaces/Cryptography.types';
import { ProtectedDataAES } from '../models/aes';

/**
 * Implements the ICryptography interface, providing a complete suite of low-level,
 * stateless cryptographic functions. This service is the "engine" of the security layer,
 * orchestrating Post-Quantum and AES primitives.
 */
export class CryptographyService implements ICryptography {
  private aesManager: AesManager;

  // Constants for seed sizes, as per @noble library requirements.
  private readonly ML_KEM_SEED_SIZE = 64;
  private readonly ML_DSA_SEED_SIZE = 32;

  constructor() {
    this.aesManager = new AesManager();
  }

  // --- Key Generation ---

  async generateKeyPairMlKem(seedBytes?: Uint8Array, crv: MlkemCurve = 'ML-KEM-768'): Promise<{ publicJWKey: MlkemPublicJwk & { kid: string }; secretKeyBytes: Uint8Array }> {
    let seed: Uint8Array;
    if (seedBytes && seedBytes.length === this.ML_KEM_SEED_SIZE) {
      seed = seedBytes;
    } else {
      seed = randomBytes(this.ML_KEM_SEED_SIZE);
    }
    
    let keygenFn: (seed: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array; };
    switch (crv) {
      case 'ML-KEM-512': keygenFn = mlKem.ml_kem512.keygen; break;
      case 'ML-KEM-1024': keygenFn = mlKem.ml_kem1024.keygen; break;
      case 'ML-KEM-768':
      default:
        keygenFn = mlKem.ml_kem768.keygen; break;
    }

    const { secretKey, publicKey: publicKeyBytes } = keygenFn(seed);
    const pubJwkWithoutKid: MlkemPublicJwk = {
      kty: 'OKP', crv: crv, x: Content.bytesToRawBase64UrlSafe(publicKeyBytes),
    };
    const publicKey = await withKid(pubJwkWithoutKid);
    return { publicJWKey: publicKey, secretKeyBytes: secretKey };
  }

  async generateKeyPairMlDsa(seedBytes?: Uint8Array, alg: MldsaAlg = 'ML-DSA-44'): Promise<{ publicJWKey: MldsaPublicJwk & { kid: string }; secretKeyBytes: Uint8Array }> {
    let seed: Uint8Array;
    if (seedBytes && seedBytes.length === this.ML_DSA_SEED_SIZE) {
      seed = seedBytes;
    } else {
      seed = randomBytes(this.ML_DSA_SEED_SIZE);
    }

    let keygenFn: (seed: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array; };
    switch (alg) {
      case 'ML-DSA-65': keygenFn = mlDsa.ml_dsa65.keygen; break;
      case 'ML-DSA-87': keygenFn = mlDsa.ml_dsa87.keygen; break;
      case 'ML-DSA-44':
      default:
        keygenFn = mlDsa.ml_dsa44.keygen; break;
    }

    const { secretKey, publicKey: publicKeyBytes } = keygenFn(seed);
    const pubJwkWithoutKid: MldsaPublicJwk = {
      kty: 'AKP', alg: alg, pub: Content.bytesToRawBase64UrlSafe(publicKeyBytes),
    };
    const publicKey = await withKid(pubJwkWithoutKid);
    return { publicJWKey: publicKey, secretKeyBytes: secretKey };
  }


  // --- High-Level Workflows ---

  async encryptJwe(payload: object, protectedHeader: object, secretJWKey: MlkemPrivateJwk, recipientsJWKeys: MlkemPublicJwk[]): Promise<JweObject> {
    const cekBytes = randomBytes(32); // Content Encryption Key
    const protectedHeaderB64Url = Content.objectToRawBase64UrlSafe(protectedHeader);
    let payloadBytes = Content.objectToBytes(payload);

    // Handle compression
    if ((protectedHeader as ProtectedHeadersJWE).zip === 'DEF') {
      payloadBytes = pako.deflate(payloadBytes);
    }
    const payloadString = Content.bytesToStringASCII(payloadBytes);

    // AES encryption
    const encrypted = await this.encrypt(payloadString, cekBytes, protectedHeaderB64Url);

    // Encapsulate the CEK for each recipient
    const recipientData: RecipientDataJWE[] = await Promise.all(
      recipientsJWKeys.map(async (jwk) => {
        const publicKeyBytes = Content.base64ToBytes(jwk.x);
        const { encapsulatedBytes } = await this.encapsulate(cekBytes, secretJWKey.dBytes, publicKeyBytes);
        return {
          header: { alg: jwk.crv, kid: jwk.kid! },
          encrypted_key: Content.bytesToRawBase64UrlSafe(encapsulatedBytes),
        };
      })
    );

    return {
      protected: protectedHeaderB64Url,
      recipients: recipientData,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
    };
  }
  
  async decryptJwe(
    jwe: JweObject | string,
    secretKeyJwk: MlkemPrivateJwk
  ): Promise<{ decryptedBytes: Uint8Array, protectedHeader: object }> {
    const jweObject = typeof jwe === 'string' ? this.parseCompactJwe(jwe) : jwe;

    const recipient = jweObject.recipients.find(r => r.header?.kid === secretKeyJwk.kid);
    if (!recipient || !recipient.encrypted_key) {
      throw new Error(`JWE does not contain a recipient with kid=${secretKeyJwk.kid}`);
    }

    // Decapsulate to get the CEK
    const encapsulatedKeyBytes = Content.base64ToBytes(recipient.encrypted_key);
    const cekBytes = await this.decapsulate(encapsulatedKeyBytes, secretKeyJwk.dBytes);

    // Decrypt the payload
    const encryptedData = { ciphertext: jweObject.ciphertext, iv: jweObject.iv, tag: jweObject.tag };
    const decryptedPayloadString = await this.decrypt(encryptedData, cekBytes, jweObject.protected);

    // Handle decompression
    let decryptedBytes = Content.stringToBytesUTF8(decryptedPayloadString);
    const protectedHeader = Content.base64UrlSafeToJSON(jweObject.protected) as ProtectedHeadersJWE;
    if (protectedHeader.zip === 'DEF') {
      decryptedBytes = pako.inflate(decryptedBytes);
    }

    return { decryptedBytes, protectedHeader };
  }

  getRecipientKidsFromJwe(jwe: JweObject | string): string[] {
    const jweObject = typeof jwe === 'string' ? this.parseCompactJwe(jwe) : jwe;

    if (!jweObject.recipients) {
      return [];
    }

    return jweObject.recipients
      .map(recipient => recipient.header?.kid)
      .filter((kid): kid is string => !!kid);
  }  

  async signDataJws(payload: object, protectedHeader: object, secretKeyBytes: Uint8Array): Promise<JwtCompactParts> {
    const protectedHeaderB64Url = Content.objectToRawBase64UrlSafe(protectedHeader);
    const payloadB64Url = await jwtUtils.encodePayload(payload);
    const signingInput = `${protectedHeaderB64Url}.${payloadB64Url}`;
    const signingInputBytes = Content.stringToBytesUTF8(signingInput);
    
    // Infer algorithm from protected header
    const alg = (protectedHeader as any).alg as MldsaAlg;
    if (!alg) throw new Error("Protected header must contain 'alg' property for signing.");
    
    const signatureBytes = await this.signBytes(signingInputBytes, secretKeyBytes, alg);
    
    return {
        protected: protectedHeaderB64Url,
        payload: payloadB64Url,
        signature: Content.bytesToRawBase64UrlSafe(signatureBytes),
    };
  }

  async verifyJws(jws: JwtCompactParts | string, publicJwk: PublicJwk): Promise<boolean> {
    const jwsParts = typeof jws === 'string' ? this.parseCompactJws(jws) : jws;
    const signingInput = `${jwsParts.protected}.${jwsParts.payload}`;
    const signingInputBytes = Content.stringToBytesUTF8(signingInput);
    const signatureBytes = Content.base64ToBytes(jwsParts.signature as string);
    return this.verifyBytes(signatureBytes, signingInputBytes, publicJwk);
  }

  async verifyDetachedJws(payloadBytes: Uint8Array, detachedJws: string, publicJWKey: PublicJwk): Promise<boolean> {
    const parts = detachedJws.split('..');
    if (parts.length !== 2) throw new Error("Invalid Detached JWS format");
    const protectedHeaderB64Url = parts[0];
    const signatureB64Url = parts[1];

    const payloadB64Url = Content.bytesToRawBase64UrlSafe(payloadBytes);
    const signingInput = `${protectedHeaderB64Url}.${payloadB64Url}`;
    const signingInputBytes = Content.stringToBytesUTF8(signingInput);
    const signatureBytes = Content.base64ToBytes(signatureB64Url);

    return this.verifyBytes(signatureBytes, signingInputBytes, publicJWKey);
  }

  // --- Low-Level Primitives ---

  encrypt(plaintext: string, cekBytes: Uint8Array, aad: string): Promise<ProtectedDataAES> {
    return this.aesManager.encrypt(plaintext, cekBytes, aad);
  }

  decrypt(encryptedData: ProtectedDataAES, cekBytes: Uint8Array, aad: string): Promise<string> {
    return this.aesManager.decrypt(encryptedData, cekBytes, aad);
  }

  async encapsulate(dataBytes: Uint8Array, secretKeyBytes: Uint8Array, recipientPublicKeyBytes: Uint8Array): Promise<{ encapsulatedBytes: Uint8Array; uncapsulatedBytes: Uint8Array; }> {
    // Note: ML-KEM's encapsulate does not use dataBytes or secretKeyBytes. It *generates* the shared secret (uncapsulatedBytes).
    // The `dataBytes` parameter could be used as a seed, but for JWE, we typically use a random CEK.
    // For consistency with JWE logic, we'll use noble's encapsulate to generate a new key.
    const { sharedSecret, cipherText } = await mlKem.ml_kem768.encapsulate(recipientPublicKeyBytes, dataBytes);
    return { uncapsulatedBytes: sharedSecret, encapsulatedBytes: cipherText };
  }
  
  async decapsulate(encapsulatedBytes: Uint8Array, secretKeyBytes: Uint8Array): Promise<Uint8Array> {
    return mlKem.ml_kem768.decapsulate(encapsulatedBytes, secretKeyBytes);
  }

  async signBytes(payloadBytes: Uint8Array, secretKeyBytes: Uint8Array, alg: MldsaAlg): Promise<Uint8Array> {
    switch (alg) {
      case 'ML-DSA-44': return mlDsa.ml_dsa44.sign(payloadBytes, secretKeyBytes);
      case 'ML-DSA-65': return mlDsa.ml_dsa65.sign(payloadBytes, secretKeyBytes);
      case 'ML-DSA-87': return mlDsa.ml_dsa87.sign(payloadBytes, secretKeyBytes);
      default: throw new Error(`Unsupported ML-DSA algorithm: ${alg}`);
    }
  }

  async verifyBytes(signatureBytes: Uint8Array, dataBytes: Uint8Array, publicKey: PublicJwk): Promise<boolean> {
    const publicKeyBytes = Content.base64ToBytes((publicKey as any).pub || (publicKey as any).x);
    const alg = (publicKey as MldsaPublicJwk).alg;
    if (!alg) throw new Error("Public key must contain 'alg' property for verification.");

    switch (alg) {
      case 'ML-DSA-44': return mlDsa.ml_dsa44.verify(signatureBytes, dataBytes, publicKeyBytes);
      case 'ML-DSA-65': return mlDsa.ml_dsa65.verify(signatureBytes, dataBytes, publicKeyBytes);
      case 'ML-DSA-87': return mlDsa.ml_dsa87.verify(signatureBytes, dataBytes, publicKeyBytes);
      default: throw new Error(`Unsupported ML-DSA algorithm: ${alg}`);
    }
  }
  
  // --- Formatting & Parsing Utilities ---

  jwsToCompact(jws: DataCompactJWT): string {
    return `${jws.protected}.${jws.payload}.${jws.signature}`;
  }

  parseCompactJws(jwsString: string): DataCompactJWT {
    if (jwsString.trim().startsWith('{')) {
      const parsed = JSON.parse(jwsString);
      if (!parsed.payload || !parsed.signatures || !parsed.signatures[0]) {
        throw new Error("Invalid JWS JSON format");
      }
      return {
        payload: parsed.payload,
        protected: parsed.signatures[0].protected,
        signature: parsed.signatures[0].signature,
      };
    }
    const parts = jwtUtils.getPartsJWT(jwsString);
    if (!parts) throw new Error("Invalid Compact JWS format");

    const result: DataCompactJWT = {
      payload: Content.base64UrlSafeToJSON(parts.payload),
      protected: Content.base64UrlSafeToJSON(parts.protected),
      signature: Content.base64ToBytes(parts.payload),
    };
    return result;
  }

  /**
   * Converts a JWE Object into Compact Serialization format.
   * This is only possible if the JWE has exactly one recipient and no shared unprotected header.
   *
   * --- The "Merging" Logic Explained ---
   * A Compact JWE has only one header, the 'protected' header. This header must contain
   * all the necessary information for the recipient to decrypt the message. In the JWE JSON
   * Serialization, this information is split:
   * - Main `protected` header: Contains content encryption info (e.g., `enc`).
   * - Recipient `header`: Contains key encryption info (e.g., `alg`, `kid`).
   *
   * This method performs a standard operation: it merges the recipient's header into the
   * main protected header to create the single, complete header required for compact serialization.
   *
   * @param jwe The JWE Object to convert.
   * @returns The JWE in Compact Serialization format.
   */
  jweToCompact(jwe: JweObject): string {
    if (jwe.recipients.length !== 1) {
      throw new Error("JWE cannot be converted to Compact Serialization: must have exactly one recipient.");
    }
    if (jwe.unprotected) {
      throw new Error("JWE cannot be converted to Compact Serialization: must not have a shared unprotected header.");
    }

    const recipient = jwe.recipients[0];
    if (!recipient.encrypted_key) {
      throw new Error("Invalid JWE recipient: missing encrypted_key.");
    }

    // 1. Decode the main protected header from Base64URL to a JSON object.
    const mainProtectedHeader = Content.base64UrlSafeToJSON(jwe.protected);

    // 2. Get the recipient-specific header.
    const recipientHeader = recipient.header || {};

    // 3. Merge them. Properties in `recipientHeader` will overwrite those in `mainProtectedHeader` if there's a conflict.
    const finalProtectedHeader = { ...mainProtectedHeader, ...recipientHeader };

    // 4. Re-encode the newly created, complete header into Base64URL.
    const finalProtectedHeaderB64Url = Content.objectToRawBase64UrlSafe(finalProtectedHeader);

    // 5. Assemble the 5 parts of the compact JWE.
    return `${finalProtectedHeaderB64Url}.${recipient.encrypted_key}.${jwe.iv}.${jwe.ciphertext}.${jwe.tag}`;
  }

  parseCompactJwe(jweString: string): JweObject {
    if (jweString.trim().startsWith('{')) {
      return JSON.parse(jweString);
    }
    const parts = jweString.split('.');
    if (parts.length !== 5) throw new Error("Invalid Compact JWE format");
    const protectedHeader = Content.base64UrlSafeToJSON(parts[0]);
    // Compact JWE has no per-recipient header, but our model requires one.
    // The 'kid' should be in the main protected header for decryption to work.
    return {
      protected: parts[0],
      recipients: [{ 
        header: { alg: (protectedHeader as any).alg || '', kid: (protectedHeader as any).kid || '' },
        encrypted_key: parts[1] 
      }],
      iv: parts[2],
      ciphertext: parts[3],
      tag: parts[4],
    };
  }
}
