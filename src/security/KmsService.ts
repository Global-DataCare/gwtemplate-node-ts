// src/security/KmsService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EncryptionOptions, ICryptography } from './interfaces/ICryptography';
import { IKmsService } from './interfaces/IKmsService';
import { JWK } from '@/models/jwk';
import { JwsObject } from '@/models/jws';
import { PublicJWKey } from '@/models/crypto';
import { DecodedDidcommMessage } from '@/models/request';
import { DidDocument } from '@/models/did';
import { ConfidentialStorageDoc } from '@/models/confidential-storage';

/**
 * High-level service for Key Management and cryptographic operations.
 * It orchestrates low-level crypto utilities (via ICryptography) to provide
 * business-level security functions.
 */
export class KmsService implements IKmsService {
  private crypto: ICryptography;

  constructor(cryptographyService: ICryptography) {
    this.crypto = cryptographyService;
  }

  // --- Implemented in this TDD Cycle ---

  async decodeRequest(encryptedMessage: string): Promise<DecodedDidcommMessage> {
    const decryptedJsonString = await this.crypto.decrypt(encryptedMessage);
    let payload: any;
    try {
      payload = JSON.parse(decryptedJsonString);
    } catch (error: any) {
      throw new Error(`Failed to parse decoded payload: ${error.message}`);
    }
    if (!payload.thid) {
      throw new Error('Invalid payload: "thid" is a required property.');
    }
    return payload as DecodedDidcommMessage;
  }

  async encodeResponse(responsePayload: any, recipientJwks: JWK[], options?: EncryptionOptions): Promise<string> {
    return this.crypto.encrypt(responsePayload, recipientJwks, options);
  }

  // --- Not Implemented in this TDD Cycle ---

  protectDocument(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> {
    throw new Error('Method not implemented.');
  }

  unprotectDocument<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T> {
    throw new Error('Method not implemented.');
  }

  sign(entityId: string, payload: Uint8Array): Promise<JwsObject> {
    throw new Error('Method not implemented.');
  }

  verify(jws: JwsObject): Promise<{ verified: boolean; payload: Uint8Array; }> {
    throw new Error('Method not implemented.');
  }

  getDidDocument(entityId: string): Promise<DidDocument> {
    throw new Error('Method not implemented.');
  }

  getPublicJwks(entityId: string): Promise<{ keys: PublicJWKey[]; }> {
    throw new Error('Method not implemented.');
  }

  getPublicVerificationKey(entityId: string): Promise<PublicJWKey | undefined> {
    throw new Error('Method not implemented.');
  }

  getPublicEncryptionKey(entityId: string): Promise<PublicJWKey | undefined> {
    throw new Error('Method not implemented.');
  }
}
