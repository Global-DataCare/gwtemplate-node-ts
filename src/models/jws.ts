// src/models/jws.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { JWK } from './jwk';

/**
 * Represents the header parameters of a JSON Web Signature (JWS).
 */
export interface JwsHeader {
    /** Algorithm used to secure the JWS. Must not be "none". */
    alg: string;
    /** Key ID that indicates which key was used for the JWS signature. */
    kid: string;
    /** Content type, usually "didcomm-signed+json". */
    cty?: string;
    /** Type of the message, usually "jwt". */
    typ?: string;
    /** The full public key, used in bootstrapping scenarios. */
    jwk?: JWK;
}

/**
 * Represents a signature entry in a JWS using the General JSON Serialization format.
 */
export interface JwsDetachedSignParts {
    /** The Base64URL encoded protected (signed) header. */
    protected: string;
    /** The Base64URL encoded signature. */
    signature: string;
}

/**
 * Represents a JWS (JSON Web Signature) in the General JSON Serialization format.
 * This structure supports multiple signatures.
 */
export interface JwsMultiSign {
    /** The Base64URL encoded payload. */
    payload: string;
    /** An array of one or more signatures. */
    signatures: JwsDetachedSignParts[];
}
