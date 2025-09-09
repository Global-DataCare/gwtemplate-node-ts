// src/security/DevKmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from './interfaces/IKmsService';
import { ConfidentialStorageDoc } from '@/models/confidential-storage';
import { DecodedDidcommMessage } from '@/models/request';
import { DidDocument } from '@/models/did';
import { JwsObject } from '@/models/jws';
import { PublicJWKey } from '@/models/crypto';
import { ITenantManager } from '@/managers/ITenantManager';
import { encode as base64urlEncode, decode as base64urlDecode } from 'js-base64';

/**
 * A development-only implementation of the Key Management Service that correctly
 * simulates the behavior and data structures of a real KMS without performing
 * actual cryptography.
 *
 * It ensures that policy enforcement and data shapes are consistent between
 * development and production environments.
 *
 * WARNING: DO NOT USE IN PRODUCTION.
 */
export class DevKmsService implements IKmsService {
  private tenantManager: ITenantManager;

  constructor(tenantManager: ITenantManager) {
    this.tenantManager = tenantManager;
  }

  /**
   * "Decodes" a request by parsing the input string as JSON.
   */
  public async decodeRequest(encryptedMessage: string): Promise<DecodedDidcommMessage> {
    try {
      return JSON.parse(encryptedMessage) as DecodedDidcommMessage;
    } catch (e) {
      throw new Error('Invalid JSON provided to DevKmsService.decodeRequest');
    }
  }

  /**
   * "Encodes" a response by serializing it to a JSON string.
   */
  public async encodeResponse(responsePayload: any): Promise<string> {
    return JSON.stringify(responsePayload);
  }

  /**
   * Simulates protecting a document by base64url-encoding the content and moving
   * it to the `jwe` property, mimicking a JWE with "alg": "none".
   * The original `content` property is deleted.
   */
  public async protectDocument(doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> {
    if (!doc.content) {
      return doc;
    }
    const plaintext = JSON.stringify(doc.content);
    const ciphertext = base64urlEncode(plaintext);
    const protectedHeader = base64urlEncode(JSON.stringify({ alg: 'none' }));

    const secureDoc: ConfidentialStorageDoc = {
      ...doc,
      jwe: {
        protected: protectedHeader,
        ciphertext: ciphertext,
      },
    };
    delete secureDoc.content;
    return secureDoc;
  }

  /**
   * Simulates unprotecting a document by base64url-decoding the ciphertext
   * from the `jwe` property.
   */
  public async unprotectDocument<T>(doc: ConfidentialStorageDoc): Promise<T> {
    if (!doc.jwe?.ciphertext) {
      throw new Error('DevKmsService: Cannot unprotect a document with no JWE ciphertext.');
    }
    const plaintext = base64urlDecode(doc.jwe.ciphertext);
    return JSON.parse(plaintext) as T;
  }

  /**
   * Retrieves the REAL DID Document for a given entity from the TenantManager.
   * This is critical for ensuring API policy enforcement works in the dev environment.
   */
  public async getDidDocument(entityId: string): Promise<DidDocument> {
    const tenantConfig = await this.tenantManager.getConfigByAlternateName(entityId);
    if (!tenantConfig || !tenantConfig.didDocument) {
      throw new Error(`DevKmsService: Could not find DID Document for entity: ${entityId}`);
    }
    return tenantConfig.didDocument;
  }

  // --- Mock Implementations for other required methods ---

  public async sign(): Promise<JwsObject> {
    console.warn('DevKmsService: sign() is not implemented.');
    return {} as JwsObject;
  }

  public async verify(): Promise<{ verified: boolean; payload: Uint8Array }> {
    console.warn('DevKmsService: verify() is not implemented.');
    return { verified: true, payload: new Uint8Array() };
  }

  public async getPublicJwks(): Promise<{ keys: PublicJWKey[] }> {
    console.warn('DevKmsService: getPublicJwks() is not implemented.');
    return { keys: [] };
  }

  public async getPublicVerificationKey(): Promise<PublicJWKey | undefined> {
    console.warn('DevKmsService: getPublicVerificationKey() is not implemented.');
    return undefined;
  }

  public async getPublicEncryptionKey(): Promise<PublicJWKey | undefined> {
    console.warn('DevKmsService: getPublicEncryptionKey() is not implemented.');
    return undefined;
  }
}
