// TDD contract: write this test red first; make it green only with the complete real behavior.
// src/__tests__/unit/auth/token-verifier-registry.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import {
  clearTokenVerifierAdapters,
  listTokenVerifierAdapters,
  registerTokenVerifierAdapter,
  resolveTokenVerifierFromEnv,
} from '../../../auth/token-verifier-registry';
import { DemoTokenVerifier } from '../../../auth/DemoTokenVerifier';
import { FirebaseTokenVerifier } from '../../../auth/FirebaseTokenVerifier';
import { GenericOidcTokenVerifier } from '../../../auth/GenericOidcTokenVerifier';
import { TrustedOidcTokenVerifier } from '../../../auth/TrustedOidcTokenVerifier';
import { ITokenVerifier } from '../../../auth/ITokenVerifier';

class CustomVerifier implements ITokenVerifier {
  public async verify(): Promise<any> {
    return { valid: true, payload: { sub: 'custom' } };
  }
}

describe('token-verifier-registry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    clearTokenVerifierAdapters();
    process.env = { ...originalEnv };
    delete process.env.AUTH_TOKEN_VERIFIER;
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_JWKS_URI;
    delete process.env.OIDC_TRUSTED_PROVIDERS_JSON;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to DemoTokenVerifier in test env when AUTH_TOKEN_VERIFIER is not set', () => {
    const verifier = resolveTokenVerifierFromEnv(true);
    expect(verifier).toBeInstanceOf(DemoTokenVerifier);
  });

  it('defaults to FirebaseTokenVerifier when not test env and AUTH_TOKEN_VERIFIER is not set', () => {
    const verifier = resolveTokenVerifierFromEnv(false);
    expect(verifier).toBeInstanceOf(FirebaseTokenVerifier);
  });

  it('resolves custom adapter by name', () => {
    registerTokenVerifierAdapter('my-idp', () => new CustomVerifier());
    process.env.AUTH_TOKEN_VERIFIER = 'my-idp';
    const verifier = resolveTokenVerifierFromEnv(false);
    expect(verifier).toBeInstanceOf(CustomVerifier);
    expect(listTokenVerifierAdapters()).toEqual(['my-idp']);
  });

  it('throws for unsupported verifier key', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'unsupported-idp';
    expect(() => resolveTokenVerifierFromEnv(false)).toThrow("Unsupported AUTH_TOKEN_VERIFIER='unsupported-idp'");
  });

  it('builds one trusted OIDC verifier that routes several configured issuers inside the same GW deployment', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'trusted-oidc';
    process.env.OIDC_TRUSTED_PROVIDERS_JSON = JSON.stringify([
      {
        issuer: 'globaldatacare.es',
        audience: 'globaldatacare.es',
      },
      {
        issuer: 'https://securetoken.google.com/unid-production',
        audience: 'unid-production',
      },
    ]);

    const verifier = resolveTokenVerifierFromEnv(false);

    expect(verifier).toBeInstanceOf(TrustedOidcTokenVerifier);
  });

  it('builds the single-provider OIDC verifier without duplicating the discoverable jwks_uri', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'oidc';
    process.env.OIDC_ISSUER = 'globaldatacare.es';
    process.env.OIDC_AUDIENCE = 'globaldatacare.es';

    const verifier = resolveTokenVerifierFromEnv(false);

    expect(verifier).toBeInstanceOf(GenericOidcTokenVerifier);
  });

  it('fails startup when a trusted OIDC provider omits its exact audience', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'trusted-oidc';
    process.env.OIDC_TRUSTED_PROVIDERS_JSON = JSON.stringify([
      {
        issuer: 'globaldatacare.es',
        jwksUri: 'https://globaldatacare.es/.well-known/jwks.json',
      },
    ]);

    expect(() => resolveTokenVerifierFromEnv(false)).toThrow(
      'OIDC_TRUSTED_PROVIDERS_JSON[0].audience is required',
    );
  });
});
