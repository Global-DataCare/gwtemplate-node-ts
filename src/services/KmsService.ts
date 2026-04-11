import { VerificationMethod } from '../gdc-backend-utils-node/models/did';// src/services/KmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { JWK, JwkSet } from '../gdc-backend-utils-node/models/jwk';
import { JwsHeader, JwsMultiSign } from 'gdc-common-utils-ts/models/jws';
import { ConfidentialStorageDoc, IndexedAttribute } from 'gdc-common-utils-ts/models/confidential-storage';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { SigningPurpose } from '../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { v4 as uuidv4 } from 'uuid';
import { MldsaPublicJwk, MlkemPrivateJwk, MlkemPublicJwk, PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { createHash, randomBytes, createPrivateKey } from 'crypto';
import { p256, p384 } from '@noble/curves/nist.js';
import { deriveKeyPair } from '../utils/pki';
import { computeHmacSha256Base64Url } from 'gdc-common-utils-ts/hmac';
import { ProtectedDataAES } from 'gdc-common-utils-ts/models/aes';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { InMemoryKeyMaterialProvider } from './in-memory-key-material-provider';
import type { KeyMaterialProvider, KeyMaterialPurpose } from './key-material-provider';
import { TenantKeyCache } from './tenant-key-cache';

import { TenantsCacheManager } from '../managers/TenantsCacheManager';

/**
 * @file Implements the Key Management Service, the central facade for all internal cryptographic operations.
 */

/**
 * Implements the Key Management Service interface.
 * This service is the high-level facade for all internal cryptographic operations,
 * abstracting away the underlying cryptographic engine and key storage mechanism.
 * 
 * @architecture
 * This in-memory implementation simulates the multi-level key hierarchy defined in 
 * `ARCHITECTURE_PATTERNS.md` under "Key Hierarchy and Envelope Encryption".
 * 
 * - **KEK Simulation**: In a production system, a Key Encryption Key (KEK) would be fetched 
 *   from a secure secret manager at startup. This KEK would then decrypt the Host DEK. 
 *   This implementation simulates the state *after* this initial decryption has occurred.
 * 
 * - **In-Memory Key Storage**: The `_managedKeys` map holds all Data Encryption Keys (DEKs) 
 *   and private keys in a decrypted, ready-to-use state for the lifecycle of the server. 
 *   This is suitable for development and testing. A production implementation would replace 
 *   this map with a secure adapter that performs just-in-time decryption of keys using 
 *   the Host DEK or a session key.
 * 
 * The `entityId` (e.g., 'host', or a tenant's UUID) is the primary identifier for a key set.
 */
type EntityKeysSet = {
  commSigningKeyPair: {
    publicJWKey: MldsaPublicJwk & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  vcSigningKeyPair: {
    publicJWKey: MldsaPublicJwk & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  legacySigningKeyPair?: {
    publicJWKey: JWK & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  encryptionKeyPair: {
    publicJWKey: MlkemPublicJwk & { kid: string; };
    secretKeyBytes: Uint8Array;
  };
  /** The entity's 32-byte Data Encryption Key (DEK), used for symmetric encryption of data at rest. */
  dataEncryptionKey: Uint8Array;
  /** The entity's 32-byte HMAC key, used for creating keyed hashes of searchable attributes. */
  hmacKey: Uint8Array;
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
  private tenantsCacheManager: TenantsCacheManager;
  /** In-memory key storage. Key: entityId, Value: KeyPairSet. */
  private _managedKeys: Map<string, EntityKeysSet>;
  private keyVersions: Map<string, number>;
  private keyMaterialProvider: KeyMaterialProvider<EntityKeysSet>;
  private isHostInitialized: boolean = false;

  constructor(
    cryptographyService: ICryptography,
    tenantsCacheManager: TenantsCacheManager,
    keyMaterialProvider?: KeyMaterialProvider<EntityKeysSet>,
    ) {
    this.crypto = cryptographyService;
    this.tenantsCacheManager = tenantsCacheManager;
    this._managedKeys = new Map();
    this.keyVersions = new Map();
    this.keyMaterialProvider = keyMaterialProvider || this.buildDefaultKeyMaterialProvider();
  }

  /**
   * Initializes the KmsService by provisioning the essential keys for the 'host' entity.
   * This method MUST be called before any other methods are used.
   */
  async init(): Promise<void> {
    if (this.isHostInitialized) {
      // console.log('[KmsService] Host keys already initialized.');
      return;
    }
    // console.log('[KmsService] Initializing host keys...');
    await this.provisionKeys('host');
    this.isHostInitialized = true;
    // console.log('[KmsService] Host keys initialized successfully.');
  }

  private checkInitialized(): void {
    if (!this.isHostInitialized) {
      throw new Error('KmsService has not been initialized. Call init() before using.');
    }
  }

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
  async provisionKeys(entityVaultId: string): Promise<JwkSet> {
    let commDsaSeed: Uint8Array;
    let vcDsaSeed: Uint8Array;
    let kemSeed: Uint8Array;
    let dataEncryptionKey: Uint8Array;
    let hmacKey: Uint8Array;

    // Use deterministic keys only in development and when explicitly requested.
    if (process.env.NODE_ENV === 'development' && process.env.DEV_SEED === 'true') {
      // Deterministic generation for development and testing.
      // Use the modern `.subarr000 está ay()` which is the safe replacement for the deprecated `.slice()` on Buffers.
      commDsaSeed = createHash('sha256').update(entityVaultId + '-dsa-comm').digest().subarray(0, 32);
      vcDsaSeed = createHash('sha256').update(entityVaultId + '-dsa-vc').digest().subarray(0, 32);
      kemSeed = createHash('sha512').update(entityVaultId + '-kem').digest().subarray(0, 64);
      dataEncryptionKey = createHash('sha256').update(entityVaultId + '-dek').digest().subarray(0, 32);
      hmacKey = createHash('sha256').update(entityVaultId + '-hmac').digest().subarray(0, 32);
    } else {
      // Secure random generation for production
      commDsaSeed = randomBytes(32);
      vcDsaSeed = randomBytes(32);
      kemSeed = randomBytes(64);
      dataEncryptionKey = randomBytes(32);
      hmacKey = randomBytes(32);
    }
    const commSigningKeyPair = await this.crypto.generateKeyPairMlDsa(commDsaSeed);
    const vcSigningKeyPair = await this.crypto.generateKeyPairMlDsa(vcDsaSeed);
    const encryptionKeyPair = await this.crypto.generateKeyPairMlKem(kemSeed);
    // Mark intended JOSE usage to allow downstream selection logic (`use === 'sig'|'enc'`).
    (commSigningKeyPair.publicJWKey as any).use = 'sig';
    (commSigningKeyPair.publicJWKey as any).purpose = 'comm_sig';
    (vcSigningKeyPair.publicJWKey as any).use = 'sig';
    (vcSigningKeyPair.publicJWKey as any).purpose = 'vc_sign';
    (encryptionKeyPair.publicJWKey as any).use = 'enc';

    const legacySigningKeyPair = await this.provisionLegacySigningKey(entityVaultId, process.env.LEGACY_SIGN_ALG);

    // In a production vault, the `dataEncryptionKey` would be encrypted with the Host KEK here before storage.
    this._managedKeys.set(entityVaultId, { 
      commSigningKeyPair: { publicJWKey: commSigningKeyPair.publicJWKey, secretKeyBytes: commSigningKeyPair.secretKeyBytes },
      vcSigningKeyPair: { publicJWKey: vcSigningKeyPair.publicJWKey, secretKeyBytes: vcSigningKeyPair.secretKeyBytes },
      ...(legacySigningKeyPair ? { legacySigningKeyPair } : {}),
      encryptionKeyPair: { publicJWKey: encryptionKeyPair.publicJWKey, secretKeyBytes: encryptionKeyPair.secretKeyBytes },
      dataEncryptionKey: dataEncryptionKey,
      hmacKey: hmacKey
    });
    this.keyVersions.set(entityVaultId, (this.keyVersions.get(entityVaultId) || 0) + 1);
    this.keyMaterialProvider.invalidate(entityVaultId, 'all');
    
    const publicJwkSet = {
      keys: [
        commSigningKeyPair.publicJWKey as JWK,
        vcSigningKeyPair.publicJWKey as JWK,
        ...(legacySigningKeyPair ? [legacySigningKeyPair.publicJWKey as JWK] : []),
        encryptionKeyPair.publicJWKey as JWK,
      ],
    };

    //     // console.log(`[KmsService] Provisioned new JWKSet for entity: ${entityVaultId}`, publicJwkSet);

    return publicJwkSet;
  }

  /**
   * Retrieves the public parts of an entity's asymmetric keys.
   * @param entityId The unique identifier for the entity.
   * @returns A JWKSet of the entity's public keys.
   */
  async getPublicJwks(entityVaultId: string): Promise<JwkSet> {
    const keyPairSet = await this.getEntityKeys(entityVaultId, 'all');
    return {
      keys: [
        keyPairSet.commSigningKeyPair.publicJWKey as JWK,
        keyPairSet.vcSigningKeyPair.publicJWKey as JWK,
        ...(keyPairSet.legacySigningKeyPair ? [keyPairSet.legacySigningKeyPair.publicJWKey as JWK] : []),
        keyPairSet.encryptionKeyPair.publicJWKey as JWK
      ]
    };
  }

  async getPublicVerificationKey(entityVaultId: string, alg?: string, purpose: SigningPurpose = 'comm_sig'): Promise<PublicJwk | undefined> {
    let keySet: EntityKeysSet;
    try {
      keySet = await this.getEntityKeys(entityVaultId, 'vc_sign');
    } catch {
      return undefined;
    }

    // Default without algorithm hint uses selected signing domain.
    if (!alg) {
      return purpose === 'vc_sign'
        ? keySet.vcSigningKeyPair.publicJWKey
        : keySet.commSigningKeyPair.publicJWKey;
    }

    // Legacy ES* remains dedicated to legacy VC/JWT compatibility.
    if (keySet.legacySigningKeyPair && keySet.legacySigningKeyPair.publicJWKey.alg === alg) {
      return keySet.legacySigningKeyPair.publicJWKey as PublicJwk;
    }

    // For modern algorithms shared by comm/vc (e.g. ML-DSA-*), pick according to selected purpose.
    if (purpose === 'vc_sign' && keySet.vcSigningKeyPair.publicJWKey.alg === alg) {
      return keySet.vcSigningKeyPair.publicJWKey;
    }
    if (purpose === 'comm_sig' && keySet.commSigningKeyPair.publicJWKey.alg === alg) {
      return keySet.commSigningKeyPair.publicJWKey;
    }
    // Fallback: return whichever domain matches requested algorithm.
    if (keySet.vcSigningKeyPair.publicJWKey.alg === alg) return keySet.vcSigningKeyPair.publicJWKey;
    if (keySet.commSigningKeyPair.publicJWKey.alg === alg) return keySet.commSigningKeyPair.publicJWKey;
    return undefined;
  }

  async getPublicEncryptionKey(entityVaultId: string, crv?: string): Promise<MlkemPublicJwk | undefined> {
    let keySet: EntityKeysSet;
    try {
      keySet = await this.getEntityKeys(entityVaultId, 'encryption');
    } catch {
      return undefined;
    }

    // For now, we only support one key type, so we ignore the 'crv' parameter.
    // In the future, this would filter a list of keys.
    // Default to ML-KEM-768 if no crv is provided.
    if (!crv || crv === 'ML-KEM-768') {
      return keySet.encryptionKeyPair.publicJWKey;
    }
    
    // Placeholder for legacy P-256 key lookup
    return undefined;
  }

  /**
   * Exports the legacy (ES256/ES384) signing private key as PEM (PKCS8).
   * Used for mTLS when reusing the legacy X.509 keypair.
   */
  async getLegacyPrivateKeyPem(entityVaultId: string): Promise<string | undefined> {
    const keySet = await this.getEntityKeys(entityVaultId, 'vc_sign');
    if (!keySet?.legacySigningKeyPair) return undefined;
    const publicJwk = keySet.legacySigningKeyPair.publicJWKey as any;
    if (!publicJwk?.x || !publicJwk?.y) return undefined;
    const d = Buffer.from(keySet.legacySigningKeyPair.secretKeyBytes).toString('base64url');
    const jwk = { ...publicJwk, d };
    const keyObj = createPrivateKey({ key: jwk, format: 'jwk' });
    return keyObj.export({ format: 'pem', type: 'pkcs8' }).toString();
  }

  async getHostPublicJwkSet(): Promise<JwkSet> {
    this.checkInitialized();
    const hostKeys = await this.getEntityKeys('host', 'all');
    return {
      keys: [
        hostKeys.commSigningKeyPair.publicJWKey as JWK,
        hostKeys.vcSigningKeyPair.publicJWKey as JWK,
        ...(hostKeys.legacySigningKeyPair ? [hostKeys.legacySigningKeyPair.publicJWKey as JWK] : []),
        hostKeys.encryptionKeyPair.publicJWKey as JWK,
      ],
    };
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
  async decodeRequest(message: string): Promise<JobRequest> {
    this.checkInitialized();

    const job: JobRequest = {
      id: uuidv4(),
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      // These are populated by the HTTP layer (path params / middleware) in normal flows.
      // `decodeRequest()` only deals with JOSE decoding and may be used standalone in tests.
      section: 'unknown',
      format: 'unknown',
      resourceType: 'unknown',
      action: 'unknown',
    };

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
    const decryptedPayload = Content.bytesToStringUTF8(decryptedBytes);

    // ARCHITECTURE KEEPER: Adhere to JOSE standards for nested tokens.
    // The `cty` (Content Type) header in the JWE's protected header indicates the
    // nature of the encrypted payload.
    if ((protectedHeader as { cty?: string }).cty === 'JWS') {
      // Case 1: The payload is a JWS string, as indicated by the standard header.
      const dataJwt = this.crypto.parseCompactJws(decryptedPayload);
      const jwsProtected = dataJwt.protected as JwsHeader;
      job.content = dataJwt.payload as IDecodedDidcommPayload;
      if (!job.content.meta) job.content.meta = {};
      job.content.meta.jws = { 
        protected: jwsProtected, 
        signature: dataJwt.signature ? Content.bytesToRawBase64UrlSafe(dataJwt.signature) : ''
      };
      job.content.meta.jwe = { header: protectedHeader };
      return job;
    } else {
      // Case 2: No `cty` header is present. We assume the payload is a direct JSON object.
      // This is the case for job responses generated by our own worker.
      job.content = JSON.parse(decryptedPayload) as IDecodedDidcommPayload;
      if (!job.content.meta) job.content.meta = {};
      job.content.meta.jwe = { header: protectedHeader };
      return job;
    }
  }

  // --- Signing Operations ---

  /**
   * Signs a payload using a key directly managed by the KMS.
   * The key is located using the `entityId` (e.g., 'host').
   * @param payload The raw byte array to be signed.
   * @param entityId The identifier of the signing entity.
   * @returns A `JwsMultiSign` object containing the signature.
   */
  async signWithManagedKey(
    payload: Uint8Array,
    entityVaultId: string,
    alg?: string,
    purpose: SigningPurpose = 'vc_sign',
  ): Promise<JwsMultiSign> {
    const keyPairSet = await this.getEntityKeys(entityVaultId, purpose);
    const signingKey = this.resolveSigningKey(keyPairSet, alg, purpose);
    if (!signingKey) {
      throw new Error(`Signing key not found for entity: ${entityVaultId} (alg=${alg || 'default'})`);
    }
    const jwsParts = await this.signJwsPayload(payload, signingKey);
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
    this.checkInitialized();
    const protectorKeys = await this.getEntityKeys(protectorEntityId, 'storage');

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

  async createDetachedJws(
    payload: object,
    signerKid: string,
    signerVaultId: string,
    purpose: SigningPurpose = 'vc_sign',
  ): Promise<string> {
    this.checkInitialized();
    const keyPairSet = await this.getEntityKeys(signerVaultId, purpose);
    const signingKey = this.resolveSigningKeyByKid(keyPairSet, signerKid);
    if (!signingKey) {
      throw new Error(`Signing key '${signerKid}' not found for entity: ${signerVaultId}`);
    }
    const jwsParts = await this.signJwsObject(payload, signingKey);
    
    // Format as detached JWS: HEADER..SIGNATURE
    return `${jwsParts.protected}..${jwsParts.signature}`;
  }

  async createCompactJws(
    payload: object,
    signerKid: string,
    signerVaultId: string,
    purpose: SigningPurpose = 'vc_sign',
  ): Promise<string> {
    this.checkInitialized();
    const keyPairSet = await this.getEntityKeys(signerVaultId, purpose);
    const signingKey = this.resolveSigningKeyByKid(keyPairSet, signerKid);
    if (!signingKey) {
      throw new Error(`Signing key '${signerKid}' not found for entity: ${signerVaultId}`);
    }
    const jwsParts = await this.signJwsObject(payload, signingKey);
    return `${jwsParts.protected}.${jwsParts.payload}.${jwsParts.signature}`;
  }

  private async provisionLegacySigningKey(entityVaultId: string, alg?: string): Promise<EntityKeysSet['legacySigningKeyPair'] | undefined> {
    const legacyAlg = (alg === 'ES256' || alg === 'ES384') ? alg : 'ES384';
    if (!legacyAlg.startsWith('ES')) {
      return undefined;
    }
    const seedHex = (process.env.NODE_ENV === 'development' && process.env.DEV_SEED === 'true')
      ? createHash('sha256').update(`${entityVaultId}-legacy`).digest('hex')
      : undefined;
    const curve = legacyAlg === 'ES384' ? 'P-384' : 'P-256';
    const { jwk, kid } = await deriveKeyPair(seedHex, curve);
    const publicJwk = {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      kid: kid,
      alg: legacyAlg,
      use: 'sig',
    } as JWK & { kid: string };
    const secretKeyBytes = Buffer.from(jwk.d, 'base64url');
    return { publicJWKey: publicJwk, secretKeyBytes };
  }

  private resolveSigningKey(keySet: EntityKeysSet, alg: string | undefined, purpose: SigningPurpose) {
    if (!alg) {
      if (purpose === 'comm_sig') {
        return {
          publicJwk: keySet.commSigningKeyPair.publicJWKey as JWK & { kid: string },
          secretKeyBytes: keySet.commSigningKeyPair.secretKeyBytes,
        };
      }
      return { publicJwk: keySet.vcSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.vcSigningKeyPair.secretKeyBytes };
    }
    if (purpose === 'vc_sign' && alg === keySet.vcSigningKeyPair.publicJWKey.alg) {
      return { publicJwk: keySet.vcSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.vcSigningKeyPair.secretKeyBytes };
    }
    if (purpose === 'comm_sig' && alg === keySet.commSigningKeyPair.publicJWKey.alg) {
      return { publicJwk: keySet.commSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.commSigningKeyPair.secretKeyBytes };
    }
    // Fallback for shared algs: prefer VC then comm.
    if (alg === keySet.vcSigningKeyPair.publicJWKey.alg) {
      return { publicJwk: keySet.vcSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.vcSigningKeyPair.secretKeyBytes };
    }
    if (alg === keySet.commSigningKeyPair.publicJWKey.alg) {
      return { publicJwk: keySet.commSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.commSigningKeyPair.secretKeyBytes };
    }
    if (keySet.legacySigningKeyPair && keySet.legacySigningKeyPair.publicJWKey.alg === alg) {
      return { publicJwk: keySet.legacySigningKeyPair.publicJWKey, secretKeyBytes: keySet.legacySigningKeyPair.secretKeyBytes };
    }
    return undefined;
  }

  private resolveSigningKeyByKid(keySet: EntityKeysSet | undefined, kid: string) {
    if (!keySet) return undefined;
    if (keySet.vcSigningKeyPair.publicJWKey.kid === kid) {
      return { publicJwk: keySet.vcSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.vcSigningKeyPair.secretKeyBytes };
    }
    if (keySet.commSigningKeyPair.publicJWKey.kid === kid) {
      return { publicJwk: keySet.commSigningKeyPair.publicJWKey as JWK & { kid: string }, secretKeyBytes: keySet.commSigningKeyPair.secretKeyBytes };
    }
    if (keySet.legacySigningKeyPair?.publicJWKey.kid === kid) {
      return { publicJwk: keySet.legacySigningKeyPair.publicJWKey, secretKeyBytes: keySet.legacySigningKeyPair.secretKeyBytes };
    }
    return undefined;
  }

  private async signJwsPayload(payload: Uint8Array, signingKey: { publicJwk: JWK & { kid: string }; secretKeyBytes: Uint8Array; }) {
    const protectedHeader = { alg: signingKey.publicJwk.alg, kid: signingKey.publicJwk.kid };
    const payloadObject = { data: Content.bytesToRawBase64UrlSafe(payload) };
    return await this.signJwsObject(payloadObject, signingKey, protectedHeader);
  }

  private async signJwsObject(
    payload: object,
    signingKey: { publicJwk: JWK & { kid: string }; secretKeyBytes: Uint8Array; },
    protectedHeader?: { alg?: string; kid?: string },
  ) {
    const resolvedHeader = protectedHeader || { alg: signingKey.publicJwk.alg, kid: signingKey.publicJwk.kid };
    if (resolvedHeader.alg && resolvedHeader.alg.startsWith('ES')) {
      return await this.signJwsWithEcdsa(payload, resolvedHeader, signingKey.secretKeyBytes);
    }
    return await this.crypto.signDataJws(payload, resolvedHeader, signingKey.secretKeyBytes);
  }

  private async signJwsWithEcdsa(payload: object, protectedHeader: { alg?: string; kid?: string }, secretKeyBytes: Uint8Array) {
    const protectedHeaderB64Url = Content.objectToRawBase64UrlSafe(protectedHeader);
    const payloadB64Url = Content.objectToRawBase64UrlSafe(payload);
    const signingInput = `${protectedHeaderB64Url}.${payloadB64Url}`;
    const signingInputBytes = Content.stringToBytesUTF8(signingInput);
    const signatureBytes = (protectedHeader.alg === 'ES384'
      ? p384.sign(signingInputBytes, secretKeyBytes, { format: 'compact' } as any)
      : p256.sign(signingInputBytes, secretKeyBytes, { format: 'compact' } as any)) as Uint8Array;
    return {
      protected: protectedHeaderB64Url,
      payload: payloadB64Url,
      signature: Content.bytesToRawBase64UrlSafe(signatureBytes),
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
  async encodeResponse(payload: any, recipientJwks: JWK[], senderVaultId: string): Promise<string> {
    const senderKeys = await this.getEntityKeys(senderVaultId, 'encryption');
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
    
    // For a single recipient, we should use the compact serialization format.
    if (kemRecipientJwks.length === 1) {
      return this.crypto.encryptJweToCompact(payload, protectedHeader, senderPrivKey, kemRecipientJwks[0]);
    }
    
    // For multiple recipients, we use the general JSON serialization format.
    const jweObject = await this.crypto.encryptJwe(payload, protectedHeader, senderPrivKey, kemRecipientJwks);
    return JSON.stringify(jweObject);
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
  async protectConfidentialData(doc: ConfidentialStorageDoc, entityVaultId: string): Promise<ConfidentialStorageDoc> {
    this.checkInitialized();
    if (!doc.content) {
      throw new Error('Document has no "content" to protect.');
    }
    const protectorKeys = await this.getEntityKeys(entityVaultId, 'storage');

    const contentString = JSON.stringify(doc.content);
    // The AAD is crucial here to bind the ciphertext to the entity.
    const encryptedData = await this.crypto.encrypt(contentString, protectorKeys.dataEncryptionKey, entityVaultId);
    
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
  async unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityVaultId: string): Promise<T> {
    this.checkInitialized();
    if (!doc.jwe || typeof doc.jwe !== 'object') {
      throw new Error('Document has no valid "jwe" property to unprotect.');
    }
    const protectorKeys = await this.getEntityKeys(entityVaultId, 'storage');

    const encryptedDataObject = doc.jwe as ProtectedDataAES;
    // The AAD must match the one used during encryption.
    const decryptedString = await this.crypto.decrypt(encryptedDataObject, protectorKeys.dataEncryptionKey, entityVaultId);
    return JSON.parse(decryptedString) as T;
  }

  /**
   * Computes a keyed hash (HMAC) of a plaintext string using the specified entity's secret HMAC key.
   * @param plaintext The string to hash.
   * @param entityVaultId The vault ID of the entity (e.g., 'host', 'health-care_acme') whose HMAC key should be used.
   * @returns The resulting HMAC as a Base64UrlSafe string.
   */
  async getHmacBase64Url(plaintext: string, entityVaultId: string): Promise<string> {
    this.checkInitialized();
    const keys = await this.getEntityKeys(entityVaultId, 'hmac');
    if (!keys.hmacKey) {
      // This should not happen if provisionKeys is always used.
      throw new Error(`HMAC key is missing for entity: ${entityVaultId}`);
    }
    return computeHmacSha256Base64Url(plaintext, keys.hmacKey);
  }

  /**
   * Takes an array of plaintext attributes (with type information) and returns a new array where
   * both the `name` and `value` properties of each attribute have been protected with HMAC.
   * This is used to create the `indexed` array for a `ConfidentialStorageDoc`.
   * The implementation MUST use domain separation based on the attribute `type` to prevent collisions.
   *
   * @param attributes The array of plaintext `ParameterData` objects.
   * @param entityVaultId The security context for key selection.
   * @returns A promise that resolves to the array of protected `IndexedAttribute` objects, ready for storage.
   */
  async protectAttributesNameAndValue(attributes: ParameterData[], entityVaultId: string): Promise<IndexedAttribute[]> {
    const protectedAttributes: IndexedAttribute[] = [];
    for (const attribute of attributes) {
      if (attribute.value === undefined) {
        // Do not index undefined values. Log a warning.
        console.warn(`[KmsService] Skipping HMAC protection for attribute "${attribute.name}" because its value is undefined.`);
        continue;
      }
      // Coerce number to string for canonical representation before HMAC.
      const valueAsString = String(attribute.value);

      const protectedName = await this.getHmacBase64Url(attribute.name, entityVaultId);
      const protectedValue = await this.getHmacBase64Url(valueAsString, entityVaultId);
      
      const indexedAttr: IndexedAttribute = {
        name: protectedName,
        value: protectedValue,
        unique: attribute.unique,
      };

      // Only add the 'type' if it's not the default 'string'
      if (attribute.type && attribute.type !== 'string') {
        indexedAttr.type = attribute.type;
      }

      protectedAttributes.push(indexedAttr);
    }
    return protectedAttributes;
  }

  private buildDefaultKeyMaterialProvider(): KeyMaterialProvider<EntityKeysSet> {
    const ttlMsRaw = Number.parseInt(process.env.KEY_MATERIAL_CACHE_TTL_MS || '', 10);
    const maxEntriesRaw = Number.parseInt(process.env.KEY_MATERIAL_CACHE_MAX_ENTRIES || '', 10);
    const cache = new TenantKeyCache<EntityKeysSet>({
      ttlMs: Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? ttlMsRaw : 300_000,
      maxEntries: Number.isFinite(maxEntriesRaw) && maxEntriesRaw > 0 ? maxEntriesRaw : 1_024,
    });

    return new InMemoryKeyMaterialProvider<EntityKeysSet>({
      cache,
      loader: async (entityVaultId: string, _purpose: KeyMaterialPurpose) => {
        const keyMaterial = this._managedKeys.get(entityVaultId);
        if (!keyMaterial) {
          throw new Error(`Keys not found for entity: ${entityVaultId}`);
        }
        const keyVersion = String(this.keyVersions.get(entityVaultId) || 0);
        return { keyMaterial, keyVersion };
      },
    });
  }

  private async getEntityKeys(entityVaultId: string, purpose: KeyMaterialPurpose): Promise<EntityKeysSet> {
    const record = await this.keyMaterialProvider.get(entityVaultId, purpose);
    return record.keyMaterial;
  }
}
