// src/services/DemoKmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { JobRequest } from '../models/request';
import { JwsMultiSign } from '../models/jws';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { JwkSet, JWK } from '../models/jwk';
import { Content } from '../utils/content';
import { MldsaPublicJwk, MlkemPublicJwk } from '../crypto/interfaces/Cryptography.types';

/**
 * A development-only implementation of the Key Management Service that correctly
 * simulates the behavior and data structures of a real KMS without performing
 * actual cryptography. It allows for testing of API flows, managers, and data
 * transformations without the overhead of real encryption/signing.
 *
 * WARNING: DO NOT USE IN PRODUCTION.
 */
export class DemoKmsService implements IKmsService {
  
  // No dependencies needed for the dev/demo version for now.
  constructor() {}

  async init(): Promise<void> {
    console.warn(`[DemoKmsService] Initializing host keys...`);
    // In demo mode, provisioning is a no-op that just logs a message.
    // We call it here to maintain interface consistency.
    await this.provisionKeys('host');
  }
  
  // --- Key Lifecycle Management ---

  async provisionKeys(entityId: string): Promise<JwkSet> {
    console.warn(`[DemoKmsService] Simulating key provisioning for: ${entityId}`);
    return this.getPublicJwks(entityId);
  }

  async getPublicJwks(entityId: string): Promise<JwkSet> {
    return { keys: this.getFakeJwks(entityId) as JWK[] };
  }

  async getPublicVerificationKey(entityId: string): Promise<MldsaPublicJwk | undefined> {
    return this.getFakeJwks(entityId).find(key => key.kty === 'AKP') as MldsaPublicJwk | undefined;
  }

  async getPublicEncryptionKey(entityId: string): Promise<MlkemPublicJwk | undefined> {
    return this.getFakeJwks(entityId).find(key => key.kty === 'OKP') as MlkemPublicJwk | undefined;
  }

  async getHostPublicJwkSet(): Promise<JwkSet> {
    // In demo mode, the host's keys are just another set of fake keys.
    return this.getPublicJwks('host');
  }  

  // --- Inbound Request Processing ---

  async decodeJobRequest(message: string): Promise<JobRequest> {
    console.warn(`[DemoKmsService] Bypassing decryption for JWE. Assuming plaintext JWS.`);
    try {
      const jwsPayload = JSON.parse(message).jws;
      const [protectedB64, payloadB64] = jwsPayload.split('.');
      return {
        input: Content.base64UrlSafeToJSON(payloadB64),
        meta: {
          jws: {
            protected: Content.base64UrlSafeToJSON(protectedB64),
            payload: Content.base64UrlSafeToJSON(payloadB64),
            signature: 'dev-fake-signature'
          },
          jwe: { header: { alg: 'none', enc: 'none' } }
        },
      } as JobRequest;
    } catch (e) {
      throw new Error('Invalid JSON or JWS format provided to DemoKmsService.decodeJobRequest');
    }
  }

  // --- Signing Operations ---

  async signWithManagedKey(payload: Uint8Array, entityId: string): Promise<JwsMultiSign> {
    console.warn(`[DemoKmsService] Simulating signing for entity: ${entityId}`);
    const key = await this.getPublicVerificationKey(entityId);
    const protectedHeader = { alg: key?.alg, kid: key?.kid };
    const payloadB64 = Content.bytesToRawBase64UrlSafe(payload);
    return {
      payload: payloadB64,
      signatures: [{
        protected: Content.objectToRawBase64UrlSafe(protectedHeader),
        signature: 'dev-fake-signature'
      }],
    };
  }

  async signWithReconstructedKey(
    payload: Uint8Array,
    seedPartA: Uint8Array,
    encryptedSeedPartB: Uint8Array,
    protectorEntityId: string
  ): Promise<JwsMultiSign> {
    console.warn(`[DemoKmsService] Simulating reconstructed key signing for protector: ${protectorEntityId}`);
    // In dev, we just sign it as if we had the key directly.
    return this.signWithManagedKey(payload, 'reconstructed-dev-key');
  }

  // --- Outbound Encryption ---

  async encodeResponse(payload: any, recipientJwks: JWK[], senderId: string): Promise<string> {
    console.warn(`[DemoKmsService] Bypassing encryption for response from ${senderId}. Returning plaintext JWE.`);
    const protectedHeader = { enc: 'none', skid: `dev-sender-kid-for-${senderId}` };
    // Create a fake JWE object with plaintext payload for easy debugging
    const fakeJwe = {
      protected: Content.objectToRawBase64UrlSafe(protectedHeader),
      recipients: recipientJwks.map(r => ({ header: { kid: r.kid } })),
      payload: payload, // NOT encrypted
    };
    return JSON.stringify(fakeJwe);
  }

  // --- At-Rest Data Protection ---

  async protectConfidentialData(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> {
    console.warn(`[DemoKmsService] Simulating data protection for entity: ${entityId}`);
    if (!doc.content) return doc;
    const { content, ...docWithoutContent } = doc;
    // Simulate moving the content to a 'jwe' property without real encryption
    const simulatedJwe = { protected: { alg: 'none' }, content: content };
    return { ...docWithoutContent, jwe: simulatedJwe };
  }

  async unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T> {
    console.warn(`[DemoKmsService] Simulating data un-protection for entity: ${entityId}`);
    if (!doc.jwe || !(doc.jwe as any).content) {
      throw new Error('DemoKmsService: Cannot unprotect document with invalid simulated JWE.');
    }
    return (doc.jwe as any).content as T;
  }

  /**
   * Creates a consistent, fake JSON Web Key Set (JWKS) based on the entity's ID.
   */
  private getFakeJwks(entityId: string): (MldsaPublicJwk | MlkemPublicJwk)[] {
    return [
      {
        kid: `did:web:${entityId}#key-pqc-sig-1`,
        kty: 'AKP',
        alg: 'ML-DSA-44',
        pub: `fake-ML-DSA-public-key-for-${entityId}`,
      },
      {
        kid: `did:web:${entityId}#key-pqc-enc-1`,
        kty: 'OKP',
        crv: 'ML-KEM-768',
        x: `fake-ML-KEM-public-key-for-${entityId}`,
      },
    ];
  }
}
