// src/models/verifiable-credential.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Defines the structure for a W3C Verifiable Credential Proof.
 * This is embedded within the VC itself.
 * See: https://www.w3.org/TR/vc-data-model/#proofs-signatures
 */
export interface VerifiableCredentialProof {
  type: string;          // e.g., "JsonWebSignature2020"
  proofPurpose: string;  // e.g., "assertionMethod"
  verificationMethod: string; // The DID URL of the public key, e.g., "did:web:example.com#key-1"
  created: string;       // ISO 8601 timestamp, e.g., "2024-05-21T10:00:00Z"
  jws: string;           // The detached JWS signature string "<protected>..<signature>"
}

/**
 * Defines the structure for a W3C Verifiable Credential.
 * The credentialSubject can be any object containing the claims.
 * See: https://www.w3.org/TR/vc-data-model/
 */
export interface VerifiableCredential {
  '@context': string[];
  id?: string; // A unique identifier for the credential itself (e.g., a UUID URN)
  type: string[];
  issuer: string; // The DID of the issuer (e.g., "did:web:your-gateway.com")
  issuanceDate: string;
  expirationDate?: string; // ISO 8601 timestamp
  credentialSubject: Record<string, any>;
  proof?: VerifiableCredentialProof; // Optional during creation, required for a signed VC.
}
