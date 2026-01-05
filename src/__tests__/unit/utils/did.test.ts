// src/__tests__/unit/utils/did.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidDocument } from '../../../gdc-backend-utils-node/models/did';
import { JwkSet } from '../../../gdc-backend-utils-node/models/jwk';
import { createHostedDidWeb, getPrimaryDidWeb, findSigningMethod, populateDidDocumentFromJwks, getBaseUrlFromDidWeb } from '../../../utils/did-backend';

// --- Test Data ---
const HOST_DID = 'did:web:host.com';
const TENANT_ALT_NAME = 'acme';
const TENANT_CONTEXT = { jurisdiction: 'us', version: 'v1', sector: 'health-care' };
const HOSTED_DID = 'did:web:host.com:acme:cds-us:v1:health-care'; // Full hosted DID
const EXTERNAL_DID = 'did:web:acme.org';

const tenantDidDocWithExternal: DidDocument & { alternateName: string } = {
  '@context': ``,
  id: 'urn:antifraud:test:us:v1:health:entity:ei:123',
  alternateName: TENANT_ALT_NAME,
  alsoKnownAs: [HOSTED_DID, EXTERNAL_DID],
};

const tenantDidDocHostedOnly: DidDocument & { alternateName: string } = {
  '@context': ``,
  id: 'urn:antifraud:test:us:v1:health:entity:ei:123',
  alternateName: TENANT_ALT_NAME,
  alsoKnownAs: [HOSTED_DID],
};

const hostDidDoc: DidDocument = {
  '@context': ``,
  id: HOST_DID,
};

const testJwks: JwkSet = {
  keys: [
    { kid: 'sig-ml', use: 'sig', alg: 'ML-DSA-44', kty: 'AKP', pub: '...' },
    { kid: 'enc-ml', use: 'enc', alg: 'ML-KEM-768', kty: 'OKP', crv: 'ML-KEM-768', x: '...' },
  ],
};

// --- Tests ---

describe('DID Utility Functions (Deterministic)', () => {
  describe('createHostedDidWeb', () => {
    it('should correctly construct a full hosted DID with context path', () => {
      const result = createHostedDidWeb(HOST_DID, TENANT_ALT_NAME, TENANT_CONTEXT);
      expect(result).toBe(HOSTED_DID);
    });
  });

  describe('getPrimaryDidWeb', () => {
    it('should return the external did:web when it exists', () => {
      const result = getPrimaryDidWeb(tenantDidDocWithExternal, HOST_DID, TENANT_CONTEXT);
      expect(result).toBe(EXTERNAL_DID);
    });

    it('should return the constructed hosted did:web when no external one exists', () => {
      const result = getPrimaryDidWeb(tenantDidDocHostedOnly, HOST_DID, TENANT_CONTEXT);
      expect(result).toBe(HOSTED_DID);
    });
  });

  describe('findSigningMethod', () => {
    const populatedDoc = populateDidDocumentFromJwks(tenantDidDocWithExternal, testJwks);

    it('should return the id of the first verification method if no algorithm is specified', () => {
      const result = findSigningMethod(populatedDoc);
      expect(result).toBe(`${HOSTED_DID}#sig-ml`);
    });

    it('should find the id for a specific algorithm', () => {
      const result = findSigningMethod(populatedDoc, 'ML-DSA-44');
      expect(result).toBe(`${HOSTED_DID}#sig-ml`);
    });
  });

  describe('populateDidDocumentFromJwks', () => {
    it('should add full verification methods and reference them by ID in assertion/agreement', () => {
      const skeletonDoc: DidDocument = {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: 'did:web:example.com',
        alsoKnownAs: [],
      };
      
      const result = populateDidDocumentFromJwks(skeletonDoc, testJwks);

      // 1. Check that verificationMethod contains the full key objects
      expect(result.verificationMethod).toHaveLength(2);
      expect(result.verificationMethod?.[0]).toHaveProperty('publicKeyJwk');
      expect(result.verificationMethod?.[0].id).toBe('did:web:example.com#sig-ml');

      expect(result.verificationMethod?.[1]).toHaveProperty('publicKeyJwk');
      expect(result.verificationMethod?.[1].id).toBe('did:web:example.com#enc-ml');

      // 2. Check that assertionMethod and keyAgreement contain ONLY string references
      expect(result.assertionMethod).toHaveLength(1);
      expect(result.assertionMethod?.[0]).toBe('did:web:example.com#sig-ml');
      // Verify it's a string, not an object
      expect(typeof result.assertionMethod?.[0]).toBe('string'); 

      expect(result.keyAgreement).toHaveLength(1);
      expect(result.keyAgreement?.[0]).toBe('did:web:example.com#enc-ml');
      // Verify it's a string, not an object
      expect(typeof result.keyAgreement?.[0]).toBe('string');
    });
  });

  describe('getBaseUrlFromDidWeb', () => {
    it('should return an HTTPS url for a standard domain', () => {
      const result = getBaseUrlFromDidWeb('did:web:example.com');
      expect(result).toBe('https://example.com');
    });

    it('should return an HTTP url for localhost', () => {
      const result = getBaseUrlFromDidWeb('did:web:localhost');
      expect(result).toBe('http://localhost');
    });

    it('should correctly decode a percent-encoded port for localhost', () => {
      const result = getBaseUrlFromDidWeb('did:web:localhost%3A3000');
      expect(result).toBe('http://localhost:3000');
    });

    it('should ignore path components of the did:web', () => {
      const result = getBaseUrlFromDidWeb('did:web:example.com:some:other:path');
      expect(result).toBe('https://example.com');
    });
  });
});