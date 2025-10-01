
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/crypto/interfaces/IKmsService.ts

import { JwkSet, JWK } from '../../models/jwk';
import { JwsMultiSign } from '../../models/jws';
import { ConfidentialStorageDoc } from '../../models/confidential-storage';
import { JobRequest } from '../../models/request';
import { MldsaPublicJwk, MlkemPublicJwk } from './Cryptography.types';

/**
 * Defines the Key Management Service (KMS).
 *
 * --- Data Handling Principles ---
 * Implementations of this service MUST adhere to strict data handling rules:
 * 1.  **Serialization (Outgoing):** When preparing data for signing or encryption
 *     (e.g., in `encodeResponse`), any structured data (like JSON) MUST be
 *     converted to bytes using a strict UTF-8 encoder (`stringToBytesUTF8`).
 * 2.  **Deserialization (Incoming):** When processing incoming data that has been
 *     decrypted or decompressed (e.g., in `decodeRequest`), the resulting byte
 *     array MUST be converted to a string using a permissive ASCII/binary decoder
 *     (`bytesToStringASCII`) before parsing. This ensures robustness against
 *     binary streams that are not strictly UTF-8 compliant.
 *
 * This ensures maximum interoperability and security.
 */


/**
 * Defines the contract for the Key Management Service (KMS).
 * This service is the SINGLE FACADE for all cryptographic operations that
 * use INTERNAL keys managed by the system (e.g., for Tenants or the Host).
 * It consolidates logic from crypto utilities, JWT/JWE utilities, and key storage.
 */
export interface IKmsService {

  /**
   * Initializes the service, ensuring essential keys (like for the 'host') are provisioned.
   * MUST be called before any other methods.
   */
  init(): Promise<void>;  

  // --- Key Lifecycle Management ---

  /**
   * Generates and securely stores a new set of cryptographic keys for an entity.
   * @param entityId The entity's unique identifier (e.g., a tenant URN).
   * @returns The public parts of the generated keys (JWKSet).
   */
  provisionKeys(entityId: string): Promise<JwkSet>;

  /**
   * Retrieves all public keys for an entity.
   * This is used by high-level services like the TenantManager to construct DID Documents.
   * @param entityId The entity's unique identifier.
   * @returns The public keys in a JWKSet.
   */
  getPublicJwks(entityId: string): Promise<JwkSet>;

  /** Retrieves only the public signing key for an entity. */
  getPublicVerificationKey(entityId: string): Promise<MldsaPublicJwk | undefined>;
  
  /** Retrieves only the public encryption key for an entity. */
  getPublicEncryptionKey(entityId: string): Promise<MlkemPublicJwk | undefined>;

  /**
   * A dedicated method to get the host's public keys as a standard JWKSet.
   * This is crucial for bootstrap and discovery endpoints (e.g., jwks.json)
   * and for end-to-end testing scenarios.
   */
  getHostPublicJwkSet(): Promise<JwkSet>;

  // --- Inbound Request Processing ---

  /**
   * Decrypts and decodes an incoming message (JWE or JWS) WITHOUT verifying the signature.
   * This is the primary entry point for the asynchronous API flow. The service
   * will inspect the JWE recipients to find an internal key it can use for decryption.
   * @param message The raw, encrypted JWE string or a signed JWS string.
   * @returns A decoded `JobRequest` object containing the parsed JWE and JWS structures.
   */
  decodeJobRequest(message: string): Promise<JobRequest>;

  // --- Signing Operations ---

  /**
   * Creates a JWS by signing a raw payload using a key managed directly by the KMS (e.g., a Tenant's key).
   * This should NOT be used for keys that need to be reconstructed (like employee keys).
   * @param payload The raw data (bytes) to sign.
   * @param entityId The ID of the internal entity that is signing.
   * @returns The signed data as a JwsObject.
   */
  signWithManagedKey(payload: Uint8Array, entityId: string): Promise<JwsMultiSign>;

  /**
   * Signs a payload by reconstructing a key from its components (e.g., for an Employee's cloud key).
   * This is a high-level method that encapsulates the entire key reconstruction and signing workflow.
   * @param payload The raw data (bytes) to sign.
   * @param seedPartA The part of the seed provided by the user (plaintext).
   * @param encryptedSeedPartB The part of the seed stored by the system (encrypted).
   * @param protectorEntityId The ID of the entity (e.g., the Tenant) whose key was used to encrypt `seedPartB`.
   * @returns The signed data as a JwsObject.
   */
  signWithReconstructedKey(
    payload: Uint8Array,
    seedPartA: Uint8Array,
    encryptedSeedPartB: Uint8Array,
    protectorEntityId: string
  ): Promise<JwsMultiSign>;

  // --- Outbound Encryption ---

  /**
   * Encrypts a response payload for one or more external recipients.
   * @param payload The object to encrypt.
   * @param recipientJwks An array of public keys for the recipients.
   * @param senderId The `entityId` of the internal entity sending the response (e.g., 'host'),
   * used to locate the private encryption key for including its `skid` (sender key id) in the protected header.
   * @returns The encrypted JWE as a compact string (for one recipient) or a JSON string (for multiple).
   */
  encodeResponse(payload: any, recipientJwks: JWK[], senderId: string): Promise<string>;

  // --- At-Rest Data Protection ---

  /**
   * Encrypts a document for secure storage using an entity's symmetric key.
   * @param doc The document to protect. The sensitive data is in the `.content` property.
   * @param entityId The ID of the entity whose key should be used.
   * @returns The protected document with `.content` replaced by a `.jwe` property.
   */
  protectConfidentialData(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc>;

  /**
   * Decrypts a document from secure storage.
   * @param doc The protected document containing the `.jwe` property.
   * @param entityId The ID of the entity whose key was used.
   * @returns The decrypted content of the document.
   */
  unprotectConfidentialData<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T>;
}
