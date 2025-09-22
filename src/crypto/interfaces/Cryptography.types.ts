// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/security/interfaces/Cryptography.types.ts

/**
 * @see https://datatracker.ietf.org/doc/draft-ietf-jose-pqc-kem/
 * @see https://cose-wg.github.io/draft-ietf-cose-dilithium/draft-ietf-cose-dilithium.html
 */
;

export type CurveMlKem512 = "ML-KEM-512";
export type CurveMlKem768 = "ML-KEM-768";
export type CurveMlKem1024 = "ML-KEM-1024";

export type MlkemCurve = CurveMlKem512 | CurveMlKem768 | CurveMlKem1024;

export type AlgMlDsa2 = "ML-DSA-44";
export type AlgMlDsa3 = "ML-DSA-65";
export type AlgMlDsa5 ="ML-DSA-87";

export type MldsaAlg = AlgMlDsa2 | AlgMlDsa3 | AlgMlDsa5;

// Base JWKs used for RFC 7638 thumbprint calculation
export type MlkemBaseJwk = { kty: "OKP"; crv: MlkemCurve; x: string };
export type MldsaBaseJwk = { kty: "AKP"; alg: MldsaAlg; pub: string };
export type BaseJwk = MlkemBaseJwk | MldsaBaseJwk;

export interface MlkemPublicJwk extends MlkemBaseJwk {
    kid?: string;     // filled from thumbprint
};

export interface MldsaPublicJwk extends MldsaBaseJwk {
    kid?: string;     // filled from thumbprint
};

export type PublicJwk = MlkemPublicJwk | MldsaPublicJwk;

export interface MlkemPrivateJwk extends MlkemPublicJwk{
    // Private material (extended seed) must never be published:
    dBytes: Uint8Array;
};

export interface MldsaPrivateJwk extends MldsaPublicJwk{
    // Private material (extended seed) must never be published:
    privBytes: Uint8Array;
};


export interface RecipientInfo {
  tenantId: string;
  header?: Record<string, any>;
}

export interface SignerInfo {
  tenantId: string;
  protectedHeader: Record<string, any>;
  unprotectedHeader?: Record<string, any>;
}

export interface ProtectRequest {
  stream: Uint8Array;
  recipients: RecipientInfo[];
  protectedHeader?: Record<string, any>; // is it meta.jws.protected?
  unprotectedHeader?: Record<string, any>; // is it meta.jws.unprotected?
  aad?: Uint8Array;// src/adapters/queue.ts
  input: Record<string, any>;
  meta?: {
    jws?: { protected?: Record<string, any>; unprotected?: Record<string, any>;}; // protected and unprotected headers
    jwe?: { header?: Record<string, any>; }; // public unencypted header from the JWE
    bearer?: { jwt: { header?: Record<string, any>; payload?: Record<string, any>; } }
  };
}

export interface JWEData {
  protected?: string;
  unprotected?: Record<string, any>;
  recipients: Array<{
    header?: Record<string, any>;
    encrypted_key?: string;
  }>;
  aad?: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface SignRequest {
  payload: Uint8Array;
  signers: SignerInfo[];
}

export interface JwsObject {
  payload: string;
  signatures: Array<{
    protected: string;
    unprotected?: Record<string, any>;
    signature: string;
  }>;
}
