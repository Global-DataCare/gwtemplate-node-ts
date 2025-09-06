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
 * Represents the protected (integrity-protected) header of a JWE.
 * These parameters are combined with the AAD (Additional Authenticated Data)
 * to ensure they are not tampered with.
 *
 * JWE defines two algorithms:
 * - 'alg': The algorithm for key encryption (wrapping the CEK). In our case, a PQC KEM like Kyber.
 *          This is defined per-recipient, not in the main protected header.
 * - 'enc': The algorithm for content encryption (e.g., 'A256GCM').
 */
export interface ProtectedHeadersJWE {
    /** Algorithm for Content Encryption Key (CEK) wrapping (e.g., Kyber KEM). Defined per-recipient. */
    alg?: string;
    /** Content Type of the payload. */
    cty?: string;
    /** Encryption Algorithm for the content (e.g., 'A256GCM'). */
    enc?: string;
    /** Key ID of the recipient's public key. */
    kid?: string;
    /** Sender's public key identifier. */
    skid?: string;
    /** Type of the JWE (e.g., 'didcomm-envelope-enc'). */
    typ?: string;
    /** Compression algorithm ('DEF' for DEFLATE). */
    zip?: string;
}

/**
 * Represents the unprotected header of a JWE.
 * These parameters are not integrity-protected.
 */
export interface UnprotectedHeadersJWE {
    /** JWK Set URL, a URL pointing to a set of keys. */
    jku?: string;
}

/**
 * Represents the data specific to a single recipient of a JWE.
 */
export interface RecipientDataJWE {
    /** The Content Encryption Key (CEK), encrypted for this specific recipient. Base64URL encoded. */
    encrypted_key?: string;
    /** Unprotected header parameters specific to this recipient. */
    header: {
        /** Key Encryption Algorithm used for this recipient (e.g., 'kyber-768-r3'). */
        alg: string;
        /** Key ID of the recipient's public key (thumbprint of the JWK). */
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
 * Represents a JWE (JSON Web Encryption) in the General JSON Serialization format.
 * This structure supports multiple recipients.
 */
export interface JweObject {
    /** Base64URL encoded, integrity-protected header. */
    protected: string;
    /** Unprotected header (not integrity-protected). */
    unprotected?: UnprotectedHeadersJWE;
    /** Array of recipient-specific data. */
    recipients: RecipientDataJWE[];
    /** Initialization Vector, Base64URL encoded. */
    iv: string;
    /** The encrypted plaintext, Base64URL encoded. */
    ciphertext: string;
    /** The authentication tag, Base64URL encoded. */
    tag: string;
}