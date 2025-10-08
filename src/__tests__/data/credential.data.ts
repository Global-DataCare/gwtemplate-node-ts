// src/__tests__/data/credential.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VerifiableCredentialV2 } from "../../models/verifiable-credential";
import {
  testTenant1UrnIdentifier,
  testHostDidWebIdentifier,
  testRootOrgDidWeb
} from "./organization.data";

// ===================================================================================
// MOCK VERIFIABLE CREDENTIALS
// ===================================================================================

const testCredentialVersionHashedId = 'z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))';
const MOCK_KEY_ID = 'base64-kid-thumbprint';
const MOCK_DETACHED_JWS = 'base64protectedHeader..base64signature';

const testIssuanceDateByRootOrg = `2025-09-29T00:00:00Z`;
const testExpirationDateByRootOrg = `2025-09-28T23:59:59Z`;
const testCredentialCreatorForHost = testRootOrgDidWeb

const testIssuanceDateByHost = '2025-30-09T12:34:56Z'
const testExpirationDateByHost = '2026-30-09T12:34:56.000Z'
const testCredentialCreatorForTenant1 = testHostDidWebIdentifier

/**
 * A mock Verifiable Credential for an Organization (Tenant).
 * This represents the credential issued by the Host to a Tenant.
 */
export const testHostVc: VerifiableCredentialV2 = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: testCredentialVersionHashedId,
  type: ['VerifiableCredential', 'Organization'],
  issuer: testCredentialCreatorForHost,
  // Issuance and expiration dates are usually set dynamically in tests
  validFrom: testIssuanceDateByRootOrg,
  validUntil: testExpirationDateByRootOrg,
  credentialSubject: {
    identifier: testHostDidWebIdentifier,
  },
  proof: [{
    type: 'JsonWebSignature2020',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${testCredentialCreatorForHost}#${MOCK_KEY_ID}`,
    created: testIssuanceDateByRootOrg,
    jws: MOCK_DETACHED_JWS,
  }],
};

/**
 * A mock Verifiable Credential for an Organization (Tenant).
 * This represents the credential issued by the Host to a Tenant.
 */
export const testTenant1Vc: VerifiableCredentialV2 = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: testCredentialVersionHashedId,
  type: ['VerifiableCredential', 'Organization'],
  issuer: testCredentialCreatorForTenant1,
  // Issuance and expiration dates are usually set dynamically in tests
  validFrom: testIssuanceDateByHost,
  validUntil: testExpirationDateByHost,
  credentialSubject: {
    identifier: testTenant1UrnIdentifier, // The stable URN of the tenant
  },
  proof: [{
    type: 'JsonWebSignature2020',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${testCredentialCreatorForTenant1}#${MOCK_KEY_ID}`,
    created: testIssuanceDateByHost,
    jws: MOCK_DETACHED_JWS,
  }],
};
