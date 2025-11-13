// src/services/DemoKmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ConfidentialStorageDoc, IndexedAttribute } from '../models/confidential-storage';
import { JobRequest } from '../models/request';
import { JwsMultiSign } from '../models/jws';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { JwkSet, JWK } from '../models/jwk';
import { Content } from '../utils/content';
import { MldsaPublicJwk, MlkemPublicJwk } from '../crypto/interfaces/Cryptography.types';
import { ParameterData } from '../models/params';

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
    console.warn(`[DemoKmsService] Bypassing decryption for JWE-like message.`);
    
    // This simulates decoding a Compact JWE by splitting it and decoding the payload part.
    // The expected format is: {protected}.{encrypted_key}.{iv}.{ciphertext}.{tag}
    const parts = message.split('.');
    
    if (parts.length === 5) {
      // This is a simulated Compact JWE. The payload is the 4th part (index 3).
      console.warn(`[DemoKmsService] Detected simulated Compact JWE format.`);
      const protectedHeader = Content.base64UrlSafeToJSON(parts[0]);
      const payload = Content.base64UrlSafeToJSON(parts[3]);
      
      // We assume the inner content is a JWS, which we also simulate.
      const jwsParts = (payload as any).jws.split('.');
      const jwsProtected = Content.base64UrlSafeToJSON(jwsParts[0]);
      const jwsPayload = Content.base64UrlSafeToJSON(jwsParts[1]);

      return {
        content: jwsPayload,
        meta: {
          jws: {
            protected: jwsProtected,
            payload: jwsPayload,
            signature: 'dev-fake-signature',
          },
          jwe: { header: protectedHeader },
        },
      } as JobRequest;

    } else {
      // Fallback for simple JSON objects for legacy tests (like the ping health check).
      try {
        const parsedMessage = JSON.parse(message);
        console.warn(`[DemoKmsService] Assuming simple JSON object for legacy flow.`);
        return { content: parsedMessage } as JobRequest;
      } catch (e) {
        throw new Error('Message is not a valid simulated JWE or a plain JSON object.');
      }
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
    console.warn(`[DemoKmsService] Bypassing encryption. Returning Compact JWE representation.`);
    
    // This simulates the JARM response format (response=<JWE>) by creating a structurally valid
    // compact JWE string with a base64-encoded payload.

    const protectedHeader = Content.objectToRawBase64UrlSafe({ 
      enc: 'none', // No encryption
      alg: 'none', // No key agreement
      skid: `dev-sender-kid-for-${senderId}`,
      // Include recipient key IDs for structural consistency
      ...recipientJwks.length === 1 && { kid: recipientJwks[0].kid }
    });

    // The "ciphertext" is just the JSON payload, encoded in Base64Url.
    const fakeCiphertext = Content.objectToRawBase64UrlSafe(payload);

    // Construct the 5 parts of the compact JWE. Parts 2, 3, and 5 are placeholders.
    const fakeEncryptedKey = ''; // Part 2: Encrypted Key (empty)
    const fakeIv = 'dev-iv';       // Part 3: IV
    const fakeTag = 'dev-tag';      // Part 5: Authentication Tag

    return `${protectedHeader}.${fakeEncryptedKey}.${fakeIv}.${fakeCiphertext}.${fakeTag}`;
  }

  // --- At-Rest Data Protection ---

  async protectConfidentialData(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> {
    console.warn(`[DemoKmsService] Simulating data protection for entity: ${entityId}`);
    if (!doc.content) return doc;

    const { content, ...docWithoutContent } = doc;

    // Correctly simulate the JWE structure.
    // The `content` is stringified and base64url-encoded to mimic the `ciphertext`.
    const simulatedJwe = {
      protected: Content.objectToRawBase64UrlSafe({ alg: 'dir', enc: 'A256GCM' }),
      ciphertext: Content.objectToRawBase64UrlSafe(content),
      // Add other simulated JWE fields for structural validity
      iv: '_iv_',
      tag: '_tag_',
    };

    return { ...docWithoutContent, jwe: simulatedJwe };
  }

  async unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T> {
    console.warn(`[DemoKmsService] Simulating data un-protection for entity: ${entityId}`);
    if (!doc.jwe || !doc.jwe.ciphertext) {
      throw new Error('DemoKmsService: Cannot unprotect document with invalid simulated JWE.');
    }
    // Decode the simulated ciphertext back into a JSON object.
    return Content.base64UrlSafeToJSON(doc.jwe.ciphertext as string) as T;
  }

  async getHmacBase64Url(plaintext: string, entityId: string): Promise<string> {
    console.warn(`[DemoKmsService] Simulating HMAC for entity: ${entityId}`);
    return `hmac-of-${plaintext}`;
  }

  async protectAttributesNameAndValue(attributes: ParameterData[], entityId: string): Promise<IndexedAttribute[]> {
    console.warn(`[DemoKmsService] Simulating attribute protection for entity: ${entityId}`);
    const protectedAttributes: IndexedAttribute[] = [];
    for (const attribute of attributes) {
      if (attribute.value === undefined) {
        continue;
      }
      const valueAsString = String(attribute.value);
      
      const indexedAttr: IndexedAttribute = {
        name: `hmac-of-${attribute.name}`,
        value: `hmac-of-${valueAsString}`,
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


  /**
   * Creates a consistent, fake JSON Web Key Set (JWKS) based on the entity's ID.
   */
  private getFakeJwks(entityId: string): (MldsaPublicJwk | MlkemPublicJwk)[] {
    return [
      {
        kid: `key-pqc-sig-1`, // KIDs should be fragments, not full DIDs
        kty: 'AKP',
        alg: 'ML-DSA-44',
        pub: `fake-ML-DSA-public-key-for-${entityId}`,
      },
      {
        kid: `key-pqc-enc-1`, // KIDs should be fragments, not full DIDs
        kty: 'OKP',
        crv: 'ML-KEM-768',
        x: `fake-ML-KEM-public-key-for-${entityId}`,
      },
    ];
  }
}
