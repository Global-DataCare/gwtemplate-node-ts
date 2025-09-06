// src/models/jwk.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents a JSON Web Key (JWK), a standard format for representing cryptographic keys.
 * This interface supports both symmetric (oct) and asymmetric keys (EC, RSA, OKP, and Post-Quantum).
 * Based on RFC 7517.
 */
export interface JWK {
    /** Key Type (e.g., 'EC', 'RSA', 'oct', 'OKP', 'LWE' for Kyber). */
    kty?: string;
    /** Public Key Use ('sig' for signature, 'enc' for encryption). */
    use?: string;
    /** Key Operations for which the key is intended (e.g., ['sign', 'verify']). */
    key_ops?: string[];
    /** Algorithm intended for use with the key (e.g., 'ES256', 'kyber-768-r3'). */
    alg?: string;
    /** Key ID - a unique identifier for the key (e.g., thumbprint). */
    kid?: string;
    
    // --- Asymmetric Key Parameters ---
    /** The 'x' coordinate for an EC key, or the public key for Kyber. */
    x?: string;
    /** The 'y' coordinate for an EC key. */
    y?: string;
    /** The curve for an EC key (e.g., 'P-256'). */
    crv?: string;
    /** The private key component. For any asymmetric key. */
    d?: string;

    // --- Symmetric Key Parameters ---
    /** The symmetric key value. */
    k?: string;
    
    /** Any other custom JWK properties. */
    [propName: string]: unknown;
}

/**
 * Represents a set of JSON Web Keys (JWKs).
 */
export interface JwkSet {
    keys: JWK[];
}
