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
});

