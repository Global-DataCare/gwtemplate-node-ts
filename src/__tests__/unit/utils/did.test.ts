// src/__tests__/unit/utils/did.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidDocument } from '../../../models/did';
import { JwkSet } from '../../../models/jwk';
import { createHostedDidWeb, getPrimaryDidWeb, findSigningMethod, populateDidDocumentFromJwks, getBaseUrlFromDidWeb } from '../../../utils/did';

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
    it('should correctly multiplex keys across all did:web identifiers', () => {
      const result = populateDidDocumentFromJwks(tenantDidDocWithExternal, testJwks);
      
      expect(result.verificationMethod).toHaveLength(2); // 1 sig key * 2 dids
      expect(result.keyAgreement).toHaveLength(2); // 1 enc key * 2 dids
      expect(result.assertionMethod).toHaveLength(2);

      const externalVm = result.verificationMethod?.find(vm => vm.controller === EXTERNAL_DID);
      expect(externalVm?.id).toBe(`${EXTERNAL_DID}#sig-ml`);
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