// src/services/KmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { JWK, JwkSet } from '../models/jwk';
import { JwsMultiSign } from '../models/jws';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ICryptography } from '../crypto/interfaces/ICryptography';
import { JobRequest } from '../models/request';
import { MldsaPublicJwk, MlkemPrivateJwk, MlkemPublicJwk } from '../crypto/interfaces/Cryptography.types';
import { Content } from '../utils/content';
import { createHash, randomBytes } from 'crypto';
import { ProtectedDataAES } from '../models/aes';

/**
 * @file Implements the Key Management Service, the central facade for all internal cryptographic operations.
 */

/**
 * Internal type for storing the full key set for a managed entity.
 * This represents the data as it would be held *in memory* after being loaded and unwrapped from a secure vault.
 *
 * --- Key Hierarchy Explained ---
 * - **KEK (Key Encryption Key):** A master key, often derived from an environment secret (e.g., `KEK_SECRET`).
 *   It resides only on the host and its sole purpose is to encrypt/decrypt DEKs. It NEVER encrypts user data.
 * - **DEK (Data Encryption Key):** A unique symmetric key generated for each entity (e.g., a Tenant).
 *   Its purpose is to encrypt the entity's data at rest (e.g., `ConfidentialStorageDoc`).
 *   The DEK itself is ALWAYS stored encrypted with the KEK.
 *
 * This in-memory `KeyPairSet` holds the DEK in its decrypted form, ready for use.
 */
type KeyPairSet = {
  verificationKeyPair: {
    publicJWKey: MldsaPublicJwk & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  encryptionKeyPair: {
    publicJWKey: MlkemPublicJwk & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  /** The entity's 32-byte Data Encryption Key (DEK), used for symmetric encryption of data at rest. */
  dataEncryptionKey: Uint8Array;
}

/**
 * Implements the Key Management Service interface.
 * This service is the high-level facade for all internal cryptographic operations,
 * abstracting away the underlying cryptographic engine and key storage mechanism.
 * 
 * In this implementation, keys are stored in an in-memory Map, acting as a simple "vault".
 * The Map's key is the `entityId` (e.g., 'host', 'tenant-urn-123'), which functions as a primary,
 * human-readable identifier for the key set. In a production system, this Map would be replaced
 * by a secure database adapter (e.g., Firestore, PostgreSQL) that handles KEK-wrapping of DEKs.
 */
export class KmsService implements IKmsService {
  private crypto: ICryptography;
  /** In-memory key storage. Key: entityId, Value: KeyPairSet. */
  private _managedKeys: Map<string, KeyPairSet>;

  constructor(cryptographyService: ICryptography) {
    this.crypto = cryptographyService;
    this._managedKeys = new Map();
  }

  // --- Key Lifecycle Management ---

  // --- Key Lifecycle Management ---

  /**
   * Generates a full set of cryptographic keys (signing, encryption, DEK) for a given entity
   * and stores them in the internal vault, associated with the entity's ID.
   *
   * In development/testing environments, if `NODE_ENV` is 'development' AND the `DEV_SEED` 
   * environment variable is set to 'true', this method will generate keys deterministically 
   * using the `entityId` as a seed. This ensures that tests are reproducible. 
   * In production, it uses a cryptographically secure random source.
   *
   * @param entityId A unique identifier for the entity (e.g., 'host', 'tenant-urn-123').
   * @returns A JWKSet containing the public keys (signing and encryption).
   */
  async provisionKeys(entityId: string): Promise<JwkSet> {
    let dsaSeed: Uint8Array;
    let kemSeed: Uint8Array;
    let dataEncryptionKey: Uint8Array;

    // Use deterministic keys only in development and when explicitly requested.
    if (process.env.NODE_ENV === 'development' && process.env.DEV_SEED === 'true') {
      // Deterministic generation for development and testing.
      // Use the modern `.subarray()` which is the safe replacement for the deprecated `.slice()` on Buffers.
      dsaSeed = createHash('sha256').update(entityId + '-dsa').digest().subarray(0, 32);
      kemSeed = createHash('sha512').update(entityId + '-kem').digest().subarray(0, 64);
      dataEncryptionKey = createHash('sha256').update(entityId + '-dek').digest().subarray(0, 32);
    } else {
      // Secure random generation for production
      dsaSeed = randomBytes(32);
      kemSeed = randomBytes(64);
      dataEncryptionKey = randomBytes(32);
    }
    const verificationKeyPair = await this.crypto.generateKeyPairMlDsa();
    const encryptionKeyPair = await this.crypto.generateKeyPairMlKem();

    // In a production vault, the `dataEncryptionKey` would be encrypted with the Host KEK here before storage.
    this._managedKeys.set(entityId, { 
      verificationKeyPair: { publicJWKey: verificationKeyPair.publicJWKey, secretKeyBytes: verificationKeyPair.secretKeyBytes },
      encryptionKeyPair: { publicJWKey: encryptionKeyPair.publicJWKey, secretKeyBytes: encryptionKeyPair.secretKeyBytes },
      dataEncryptionKey: dataEncryptionKey
    });
    
    return {
      keys: [verificationKeyPair.publicJWKey as JWK, encryptionKeyPair.publicJWKey as JWK]
    };
  }

  /**
   * Retrieves the public parts of an entity's asymmetric keys.
   * @param entityId The unique identifier for the entity.
   * @returns A JWKSet of the entity's public keys.
   */
  async getPublicJwks(entityId: string): Promise<JwkSet> {
    const keyPairSet = this._managedKeys.get(entityId);
    if (!keyPairSet) {
      throw new Error(`Keys not found for entity: ${entityId}`);
    }
    return {
      keys: [keyPairSet.verificationKeyPair.publicJWKey as JWK, keyPairSet.encryptionKeyPair.publicJWKey as JWK]
    };
  }

  async getPublicVerificationKey(entityId: string): Promise<MldsaPublicJwk | undefined> {
    return this._managedKeys.get(entityId)?.verificationKeyPair.publicJWKey;
  }

  async getPublicEncryptionKey(entityId: string): Promise<MlkemPublicJwk | undefined> {
    return this._managedKeys.get(entityId)?.encryptionKeyPair.publicJWKey;
  }

  // --- Inbound Request Processing ---

  /**
   * Decrypts an incoming JWE message to reveal its inner JWS payload.
   * This is the primary entry point for the asynchronous API. It does not perform signature validation.
   * 
   * It works by:
   * 1. Inspecting the `kid` (Key ID) in the header of each JWE recipient.
   * 2. Searching the internal vault for a managed private key corresponding to one of those `kid`s.
   * 3. Using the found private key to decrypt the message via `crypto.decryptJwe`.
   * @param message A compact JWE string.
   * @returns A `JobRequest` object containing the parsed payload and metadata.
   */
  async decodeJobRequest(message: string): Promise<JobRequest> {
    const recipientKids = this.crypto.getRecipientKidsFromJwe(message);
    if (recipientKids.length === 0) {
      throw new Error('JWE does not contain any recipient key identifiers (kid).');
    }

    let foundKey: MlkemPrivateJwk | undefined;
    for (const [entityId, keySet] of Array.from(this._managedKeys.entries())) {
      if (recipientKids.includes(keySet.encryptionKeyPair.publicJWKey.kid)) {
        foundKey = { ...keySet.encryptionKeyPair.publicJWKey, dBytes: keySet.encryptionKeyPair.secretKeyBytes };
        break;
      }
    }

    if (!foundKey) {
      throw new Error(`No managed key found for any of the JWE recipients: ${recipientKids.join(', ')}`);
    }

    const { decryptedBytes, protectedHeader } = await this.crypto.decryptJwe(message, foundKey);
    const jwsString = Content.bytesToStringUTF8(decryptedBytes);
    const dataJwt = this.crypto.parseCompactJws(jwsString);

    return {
      input: dataJwt.payload,
      meta: { jws: dataJwt, jwe: { header: protectedHeader } },
    } as JobRequest;
  }

  // --- Signing Operations ---

  /**
   * Signs a payload using a key directly managed by the KMS.
   * The key is located using the `entityId` (e.g., 'host').
   * @param payload The raw byte array to be signed.
   * @param entityId The identifier of the signing entity.
   * @returns A `JwsMultiSign` object containing the signature.
   */
  async signWithManagedKey(payload: Uint8Array, entityId: string): Promise<JwsMultiSign> {
    const keyPairSet = this._managedKeys.get(entityId);
    if (!keyPairSet) {
      throw new Error(`Verification key not found for entity: ${entityId}`);
    }
    const { publicJWKey, secretKeyBytes } = keyPairSet.verificationKeyPair;
    const protectedHeader = { alg: publicJWKey.alg, kid: publicJWKey.kid };
    const jwsParts = await this.crypto.signDataJws({ data: Content.bytesToRawBase64UrlSafe(payload) }, protectedHeader, secretKeyBytes);
    
    return {
      payload: jwsParts.payload,
      signatures: [{ protected: jwsParts.protected, signature: jwsParts.signature }],
    };
  }

  /**
   * Signs a payload by first reconstructing a signing key from two seed parts.
   * This is used for keys that are not stored directly, like an employee's key.
   * It works by decrypting `encryptedSeedPartB` using the `protectorEntityId`'s Data Encryption Key (DEK).
   * @param payload The raw byte array to sign.
   * @param seedPartA The user-provided part of the seed.
   * @param encryptedSeedPartB A byte array representing the JSON-stringified `ProtectedDataAES` of the encrypted second seed part.
   * @param protectorEntityId The ID of the entity (e.g., the Tenant) whose DEK protects `seedPartB`.
   * @returns A `JwsMultiSign` object containing the signature.
   */
  async signWithReconstructedKey(
    payload: Uint8Array,
    seedPartA: Uint8Array,
    encryptedSeedPartB: Uint8Array,
    protectorEntityId: string
  ): Promise<JwsMultiSign> {
    const protectorKeys = this._managedKeys.get(protectorEntityId);
    if (!protectorKeys) {
      throw new Error(`Protector entity's keys not found: ${protectorEntityId}`);
    }

    const encryptedDataString = Content.bytesToStringUTF8(encryptedSeedPartB);
    const encryptedDataObject: ProtectedDataAES = JSON.parse(encryptedDataString);
    
    const decryptedSeedPartBString = await this.crypto.decrypt(encryptedDataObject, protectorKeys.dataEncryptionKey, protectorEntityId);
    const decryptedSeedPartB = Content.stringToBytesUTF8(decryptedSeedPartBString);

    // FIX: Use Buffer.concat for robust Uint8Array concatenation
    const fullSeed = Buffer.concat([seedPartA, decryptedSeedPartB]);

    const { publicJWKey, secretKeyBytes } = await this.crypto.generateKeyPairMlDsa(fullSeed);
    
    const protectedHeader = { alg: publicJWKey.alg, kid: publicJWKey.kid };
    const jwsParts = await this.crypto.signDataJws({ data: Content.bytesToRawBase64UrlSafe(payload) }, protectedHeader, secretKeyBytes);
    return {
      payload: jwsParts.payload,
      signatures: [{ protected: jwsParts.protected, signature: jwsParts.signature }],
    };
  }

  // --- Outbound Encryption ---

  /**
   * Encrypts a response payload for one or more external recipients.
   * This is typically used by an asynchronous Worker to prepare a response for the original caller.
   * The response is a JWE, encrypted using the recipients' public keys.
   * @param payload The JSON object to encrypt.
   * @param recipientJwks An array of public ML-KEM keys for the recipients.
   * @param senderId The `entityId` of the internal entity sending the response (e.g., 'host'),
   * used to include its `skid` (sender key id) in the protected header.
   * @returns The encrypted JWE as a compact string (for a single recipient) or a JSON string (for multiple).
   */
  async encodeResponse(payload: any, recipientJwks: JWK[], senderId: string): Promise<string> {
    const senderKeys = this._managedKeys.get(senderId);
    if (!senderKeys) {
      throw new Error(`Sender keys not found for entity: ${senderId}`);
    }
    const senderPrivKey: MlkemPrivateJwk = {
      ...senderKeys.encryptionKeyPair.publicJWKey,
      dBytes: senderKeys.encryptionKeyPair.secretKeyBytes,
    };

    const protectedHeader = {
      enc: 'A256GCM',
      alg: 'ML-KEM-768',
      skid: senderPrivKey.kid,
    };

    const kemRecipientJwks = recipientJwks as MlkemPublicJwk[];
    const jweObject = await this.crypto.encryptJwe(payload, protectedHeader, senderPrivKey, kemRecipientJwks);
    
    if (kemRecipientJwks.length !== 1) {
      return JSON.stringify(jweObject); 
    }
    return this.crypto.jweToCompact(jweObject);
  }

  // --- At-Rest Data Protection ---

  /**
   * Encrypts the `.content` of a document using the entity's managed Data Encryption Key (DEK).
   * @param doc The document to protect.
   * @param entityId The ID of the entity whose DEK will be used.
   * @returns A new document object where `.content` is replaced by a `.jwe` property
   * containing the JSON-stringified `ProtectedDataAES` object. The `entityId` is used
   * as the AAD to prevent cross-tenant decryption attacks.
   */
  async protectConfidentialData(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> {
    if (!doc.content) {
      throw new Error('Document has no "content" to protect.');
    }
    const protectorKeys = this._managedKeys.get(entityId);
    if (!protectorKeys) {
      throw new Error(`Protector entity's keys not found: ${entityId}`);
    }

    const contentString = JSON.stringify(doc.content);
    // The AAD is crucial here to bind the ciphertext to the entity.
    const encryptedData = await this.crypto.encrypt(contentString, protectorKeys.dataEncryptionKey, entityId);
    
    const { content, ...docWithoutContent } = doc;
    // FIX: The result of encryption is an object, it should be stringified for storage.
    return { ...docWithoutContent, jwe: encryptedData };
  }

  /**
   * Decrypts the `.jwe` property of a document using the entity's managed Data Encryption Key (DEK).
   * @param doc The protected document containing the `.jwe` property, which is an object of type `ProtectedDataAES`.
   * @param entityId The ID of the entity whose DEK was used. This is passed as the AAD
   * to ensure the ciphertext was intended for this entity.
   * @returns The decrypted content of the document.
   */
  async unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T> {
    if (!doc.jwe || typeof doc.jwe !== 'object') {
      throw new Error('Document has no valid "jwe" property to unprotect.');
    }
    const protectorKeys = this._managedKeys.get(entityId);
    if (!protectorKeys) {
      throw new Error(`Protector entity's keys not found: ${entityId}`);
    }

    const encryptedDataObject = doc.jwe as ProtectedDataAES;
    // The AAD must match the one used during encryption.
    const decryptedString = await this.crypto.decrypt(encryptedDataObject, protectorKeys.dataEncryptionKey, entityId);
    return JSON.parse(decryptedString) as T;
  }
}
