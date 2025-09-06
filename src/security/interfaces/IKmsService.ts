// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/security/interfaces/IKmsService.ts

import { ConfidentialStorageDoc } from "../../models/confidential-storage";
import { JwsObject } from "../../models/jws";
import { PublicJWKey } from "../../models/crypto";
import { DidDocument } from "../../models/did";
import { DecodedDidcommMessage} from '../../models/request';
import { EncryptionOptions } from "./ICryptography";
import { JWK } from "../../models/jwk";

/**
 * Defines the contract for the Key Management Service (KMS).
 * The KMS is the high-level service responsible for abstracting all cryptographic
 * operations and identity document management for a given entity (e.g., a tenant).
 * It manages key access and usage, but NEVER exposes private keys.
 */
export interface IKmsService {


    /**
     * Decodes an incoming encrypted request.
     * This is a critical entry point function for the API. It handles decryption,
     * signature verification, and structural validation of the message.
     * @param encryptedMessage The raw encrypted message from the request.
     * @returns A Promise resolving to the fully decoded and validated DIDComm message object.
     */
    decodeRequest(encryptedMessage: string): Promise<DecodedDidcommMessage>;

    /**
     * Encodes a final response payload for one or more recipients.
     * This involves orchestrating the encryption process using the recipients' full public keys.
     * @param responsePayload The plaintext response payload (e.g., a JSON:API document).
     * @param recipientJwks An array of full public JWKs for the recipients.
     * @param options Optional parameters for serialization (compact) and compression (deflate).
     * @returns A Promise resolving to the encrypted JWE/JWS string.
     */
    encodeResponse(responsePayload: any, recipientJwks: JWK[], options?: EncryptionOptions): Promise<string>;

    // --- High-Level Cryptographic Operations ---
    /**
     * Takes a document with plaintext content, encrypts it, and returns a secure, ready-to-store document.
     * Use this for persisting sensitive data.
     * @param doc The document with plaintext `.content` and `.indexed` attributes.
     * @param entityId The ID of the entity who will be the owner/recipient (e.g., tenant ID).
     * @returns A Promise resolving to the secure ConfidentialStorageDoc with `.jwe` and no `.content`.
     */
    protectDocument(doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc>;
    /**
     * Decrypts the `.jwe` content of a ConfidentialStorageDoc.
     * @param doc The secure document containing the `.jwe` property.
     * @param entityId The ID of the entity requesting decryption (for context and permissions).
     * @returns A Promise resolving to the decrypted content as an object of type T.
     */
    unprotectDocument<T>(doc: ConfidentialStorageDoc, entityId: string): Promise<T>;
    /**
     * Signs a payload on behalf of a given entity using their current verification key.
     * @param entityId The identifier for the entity that is signing.
     * @param payload The raw data (as bytes) to be signed.
     * @returns A Promise resolving to a JwsObject.
     */
    sign(entityId: string, payload: Uint8Array): Promise<JwsObject>;
    /**
     * Verifies the signature(s) of a JWS object.
     * @param jws The JwsObject to verify.
     * @returns A Promise resolving to an object indicating if the signature is valid and the decoded payload.
     */
    verify(jws: JwsObject): Promise<{ verified: boolean; payload: Uint8Array }>;


    // --- Public Identity & Key Discovery ---
    /**
     * Retrieves the DID Document for a given entity.
     * This is the source of truth for an entity's public identity.
     * Used by the `/.well-known/did.json` endpoint.
     * @param entityId The identifier for the entity (e.g., 'host', 'tenant1').
     * @returns A Promise resolving to the entity's DID Document.
     */
    getDidDocument(entityId: string): Promise<DidDocument>;

    /**
     * Retrieves the entire public key set for an entity in JWKS format.
     * Used by the `/.well-known/jwks.json` endpoint.
     * @param entityId The identifier for the entity.
     * @returns A Promise resolving to an object containing a `keys` array of PublicJWKeys.
     */
    getPublicJwks(entityId: string): Promise<{ keys: PublicJWKey[] }>;

    /**
     * Retrieves the current public key used for verifying signatures.
     * @param entityId The identifier for the entity.
     * @returns A Promise resolving to the entity's public verification key.
     */
    getPublicVerificationKey(entityId: string): Promise<PublicJWKey | undefined>;

    /**
     * Retrieves the current public key used for encryption.
     * @param entityId The identifier for the entity.
     * @returns A Promise resolving to the entity's public encryption key.
     */
    getPublicEncryptionKey(entityId: string): Promise<PublicJWKey | undefined>;
}

