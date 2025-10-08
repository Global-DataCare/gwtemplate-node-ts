// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/crypto.ts

import { MldsaPublicJwk, MlkemPublicJwk } from "../crypto/interfaces/Cryptography.types";

/**
 * Represents a public key for a classical (non-PQC) algorithm.
 * This is used for legacy compatibility, e.g., with existing X.509 infrastructure.
 */
export type ClassicPublicJwk = {
    kty: "OKP";
    crv: "Ed25519"; // Or other classic curves
    x: string;
    use: "sig";
    alg: "EdDSA";
    kid?: string;
};

/**
 * Represents a public key in JWK format, suitable for public documents like DIDs.
 * This is a union of all supported public key types, both PQC and classic.
 */
export type PublicJWKey = MlkemPublicJwk | MldsaPublicJwk | ClassicPublicJwk;

/**
 * Describes a public key and its controller, for use in JWE recipients or DID documents.
 * @see https://w3c-ccg.github.io/ld-cryptosuite-registry/
 */
export interface RecipientPublicKey {
    type: string; // "JsonWebKey2020";
    controller?: string; // DID of the key controller
    publicKeyJwk: PublicJWKey;
    nbf?: number; // Not Before timestamp
    exp?: number; // Expiration timestamp
}

/**
 * Represents a full cryptographic key pair, including the private key material.
 * This format is for internal use by the KMS and should never be exposed.
 */
export interface KeyPair extends RecipientPublicKey {
    /** The raw private key bytes. This MUST be protected at rest (encrypted). */
    privateKeyBytes: Uint8Array;
}

/**

 * Contains all cryptographic material for a single tenant, managed by the Gateway Service.
 * This object is what would be encrypted and stored in a tenant's vault.
 */
export interface TenantCryptoData {
    /** A cache of public keys of recipients this tenant frequently interacts with. */
    recipients: RecipientPublicKey[];
    /** A protected PIN/Password used to derive a key for local cryptographic operations. */
    passKey: Uint8Array; 
    /** The history of encryption key pairs used by the tenant (for key rotation). The last one is the current key. */
    keyAgreement: KeyPair[];
    /** The history of signature key pairs used by the tenant (for key rotation). The last one is the current key. */
    verificationMethod: KeyPair[];
}

