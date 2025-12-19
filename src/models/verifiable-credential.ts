// src/models/verifiable-credential.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EvidenceObjectDLT } from "./oidc4ida.evidence.model"

/**
 * Defines the JSON-LD context URI for W3C Verifiable Credentials Data Model v2.0.
 * This constant MUST be used for all V2 credential creations to ensure consistency.
 * @see https://www.w3.org/TR/vc-data-model-2.0/#contexts
 */
export const VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/** ProofEBSIv2 foresees the possibility to use different types of proofs for Verifiable Credentials,
 *  such as proofs derived from eIDAS keys (qualified) to DID keys (unqualified).
 *  In EBSI 2.0, every V-ID will only contain a single proof, which must be derived from eIDAS keys.
 *  Definition: https://www.w3.org/TR/vc-data-model/#proofs-signatures
 *  See https://ec.europa.eu/digital-building-blocks/wikis/display/EBSIDOC/Verifiable+Attestation
 *  - 'created' is REQURED, it is the ISO 8601 original timestamp of the signature, it is not the same as credential.issued (tx timestamp) (in Aries go framework use *util.TimeWithTrailingZeroMsec instead of time.Time)
 *  - 'jws' is REQUIRED, it defines the detached JWS signature string "<base64url(protectedheader)>..<base64url(signature)>"
 *  - 'proofPurpose' is REQUIRED, e.g.: assertionMethod, authentication, keyAgreement, contractAgreement, capabilityInvocation, capabilityDelegation
 *  - 'type' is REQUIRED, e.g.: "JsonWebSignature2020", "BbsBlsSignature2020", "BbsBlsSignatureProof2020".
 *  - 'verificationMethod' is REQUIRED, it is the 'urndid#keyId' to verify the signature by using the issuer's public signature key.
 */
 export interface ProofEBSIv2  {
	created?:               string // ISO 8601 original timestamp of the signature, it is not the same as credential.issued (tx timestamp) (in Aries go framework use *util.TimeWithTrailingZeroMsec instead of time.Time)
	jws?:                   string // The detached JWS signature string "<base64url(protectedheader)>..<base64url(signature)>"
	proofPurpose?:          string // assertionMethod, authentication, keyAgreement, contractAgreement, capabilityInvocation, capabilityDelegation
	type:                  string // "JsonWebSignature2020", "BbsBlsSignature2020", "BbsBlsSignatureProof2020"
	verificationMethod?:    string // The DID URL of the public key, e.g., "did:web:host.example.com#keyIdThumbprintBase64urlEncoded"
}

/**
 * Defines the structure for a W3C Verifiable Credential.
 * The credentialSubject can be any object containing the claims.
 * @see https://www.w3.org/TR/vc-data-model-2.0/#verifiable-credentials
 */
export interface VerifiableCredentialV2 {
  '@context': string[];
  id?: string; // A unique identifier for the credential, e.g. hash result of the credential version (unique URN).
  type: string[];
  /** Claims about the subject, such as the "identifier" or subject's URN */
  credentialSubject: Record<string, any>;
  /** Evidence for Identity Assurance: https://openid.net/specs/openid-ida-verified-claims-1_0-final.html#section-5.4.4 */
  evidence?: EvidenceObjectDLT[];
  /** The issuer is the creator (e.g., "did:web:gateway.example.com"), but could be distinct to the signer of a proof */
  issuer: string; // The DID of the issuer 
  /** Proof is optional during creation, but required for a signed VC */
  proof?: ProofEBSIv2 | ProofEBSIv2[];
  validFrom: string; // ISO 8601 timestamp, e.g.: 2025-09-29T11:31:00Z
  validUntil?: string; // ISO 8601 timestamp, e.g.: 2026-09-29T11:30:59Z
}
