// src/__tests__/data/credential.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VerifiableCredential } from "../../models/verifiable-credential";
import { testTenant1Data } from "./end-to-end.data";

// ===================================================================================
// MOCK VERIFIABLE CREDENTIALS
// ===================================================================================

const MOCK_CREDENTIAL_ID = 'urn:uuid:mocked-credential-uuid';
const MOCK_ISSUER_DID = 'did:web:host.example.com';
const MOCK_KEY_ID = 'base64-kid-thumbprint';
const MOCK_DETACHED_JWS = 'base64protectedHeader..base64signature';

const issuanceDateISO = new Date('2025-30-09T12:34:56.000Z').toISOString();
const expirationDateISO = new Date('2026-30-09T12:34:56.000Z').toISOString();
const signDateISO = issuanceDateISO;

/**
 * A mock Verifiable Credential for an Organization (Tenant).
 * This represents the credential issued by the Host to a Tenant.
 */
export const mockOrganizationVc: VerifiableCredential = {
  '@context': [
    'https://www.w3.org/2018/credentials/v1',
    'https://antifraud.services/',
  ],
  id: MOCK_CREDENTIAL_ID,
  type: ['VerifiableCredential', 'Organization'],
  issuer: MOCK_ISSUER_DID,
  // Issuance and expiration dates are usually set dynamically in tests
  issuanceDate: issuanceDateISO,
  expirationDate: expirationDateISO,
  credentialSubject: {
    id: testTenant1Data.identifier, // The stable URN of the tenant
  },
  proof: {
    type: 'JsonWebSignature2020',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${MOCK_ISSUER_DID}#${MOCK_KEY_ID}`,
    created: signDateISO,
    jws: MOCK_DETACHED_JWS,
  },
};
