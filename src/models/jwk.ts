// src/models/jwk.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents a JSON Web Key (JWK), a standard format for representing cryptographic keys.
 * This interface supports both symmetric (oct) and asymmetric keys (EC, RSA, OKP, and Post-Quantum).
 * Based on RFC 7517.
 */
export interface JWK {
    /** Algorithm intended for use with a ML-DSA or other signature keys (e.g., 'ES256'). */
    alg?: string;
    /** Key Operations for which the key is intended (e.g., ['sign', 'verify']). */
    key_ops?: string[];
    /** Key ID - a unique identifier for the key (e.g., RFC 7638 thumbprint). */
    kid?: string;
    /** Key Type (e.g., 'AKP' for ML-DSA, 'OKP' for ML-KEM, 'EC' for Elliptic Curve, 'RSA', ...). */
    kty?: string;
    /** Public Key Use ('sig' for signature, 'enc' for encryption). */
    use?: string;
    
    // --- Asymmetric Key Parameters ---
    /** The curve for an ML-KEM or EC key (e.g., 'P-256'). */
    crv?: string;
    /** The private key component for ML-KEM or EC asymmetric keys. */
    d?: string;
    /** The public key for ML-KEM or 'x' coordinate for an EC key. */
    x?: string;
    /** The public 'y' coordinate for an EC key. */
    y?: string;

    // --- Post-Quantum ML-DSA (Dilithium) Parameters ---
    /** The public key component for an ML-DSA key. */
    pub?: string;
    /** The private key component for an ML-DSA key. */
    priv?: string;

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
