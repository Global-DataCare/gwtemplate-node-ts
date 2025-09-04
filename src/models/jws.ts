// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/jws.ts

/**
 * Represents the core components of a JWS (JSON Web Signature) structure,
 * based on RFC 7515. This is the standard for signed data.
 */

/**
 * Represents a single signature within a JWS JSON Serialization object.
 */
export interface JwsSignature {
    /** BASE64URL(UTF8(JWS Protected Header)) */
    protected: string;
    /** JWS Unprotected Header */
    unprotected?: Record<string, any>;
    /** BASE64URL(JWS Signature) */
    signature: string;
}

/**
 * Represents a complete JWS object in JSON Serialization format.
 * This format is preferred as it supports multiple signatures.
 * @see https://datatracker.ietf.org/doc/html/rfc7515#section-7.2
 */
export interface JwsObject {
    /** The BASE64URL(JWS Payload). */
    payload: string;
    /** An array of one or more signatures. */
    signatures: JwsSignature[];
}
