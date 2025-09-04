// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/jwe.ts

/**
 * Represents the core components of a JWE (JSON Web Encryption) structure,
 * based on RFC 7516. This is the standard for encrypted data.
 */

/**
 * Decoded protected header claims in a JWE.
 * @see https://datatracker.ietf.org/doc/html/rfc7516#section-4.1
 */
export interface ProtectedHeadersJWE {
    alg?: string; // CEK encryption algorithm
    enc?: string; // Content encryption algorithm (e.g., "A256GCM")
    cty?: string; // Content type
    typ?: string; // Type, e.g., "didcomm-envelope-enc"
    kid?: string; // Recipient's key ID
    skid?: string; // Sender's key ID
    zip?: string; // Compression algorithm
}

/**
 * Unprotected headers that are not integrity protected.
 */
export interface UnprotectedHeadersJWE {
    jku?: string; // JWK Set URL
}

/**
 * Represents the data for a single recipient of the JWE.
 */
export interface RecipientDataJWE {
    encrypted_key?: string;
    header: {
        alg: string;
        kid: string;
    };
}

/**
 * Represents a JWE object before encryption.
 * It contains the plaintext data and the configuration for encryption.
 */
export interface UnencryptedJWE {
    /** The decoded protected header object. This will be base64url encoded. */
    protectHdersDecoded?: ProtectedHeadersJWE;
    /** The unprotected header object. */
    unprotected?: UnprotectedHeadersJWE;
    /** The list of recipients for whom the content is encrypted. */
    recipients: RecipientDataJWE[];
    /** 
     * The plaintext data to be encrypted, already serialized.
     * For structured data (like a TenantConfig), this MUST be the result of `JSON.stringify`.
     * For binary data (like a PDF), this MUST be a Uint8Array.
     * The cryptography layer does NOT perform serialization.
     */
    plaintext: string | Uint8Array;
}

/**
 * Represents a complete, encrypted JWE object, ready for serialization.
 * This structure aligns with the JWE JSON Serialization format.
 */
export interface JWEData {
    /** BASE64URL(UTF8(JWE Protected Header)) */
    protected: string;
    /** JWE Shared Unprotected Header */
    unprotected?: UnprotectedHeadersJWE;
    /** Array of recipients */
    recipients: RecipientDataJWE[];
    /** BASE64URL(JWE Initialization Vector) */
    iv: string;
    /** BASE64URL(JWE Ciphertext) */
    ciphertext: string;
    /** BASE64URL(JWE Authentication Tag) */
    tag: string;
    /** BASE64URL(JWE AAD) */
    aad?: string;
}
