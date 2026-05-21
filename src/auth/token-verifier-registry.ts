// src/auth/token-verifier-registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier } from './ITokenVerifier';
import { DemoTokenVerifier } from './DemoTokenVerifier';
import { FirebaseTokenVerifier } from './FirebaseTokenVerifier';
import { GoogleTokenVerifier } from './GoogleTokenVerifier';
import { AppleTokenVerifier } from './AppleTokenVerifier';
import { GenericOidcTokenVerifier } from './GenericOidcTokenVerifier';

export type TokenVerifierAdapterFactory = () => ITokenVerifier;

const adapterRegistry = new Map<string, TokenVerifierAdapterFactory>();

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function registerTokenVerifierAdapter(name: string, factory: TokenVerifierAdapterFactory): void {
  adapterRegistry.set(String(name).trim().toLowerCase(), factory);
}

export function listTokenVerifierAdapters(): string[] {
  return Array.from(adapterRegistry.keys()).sort();
}

export function clearTokenVerifierAdapters(): void {
  adapterRegistry.clear();
}

export function resolveTokenVerifierFromEnv(isTestEnv: boolean): ITokenVerifier {
  const configured = String(process.env.AUTH_TOKEN_VERIFIER || '').trim().toLowerCase();
  if (isTestEnv && !configured) {
    return new DemoTokenVerifier();
  }

  const key = configured || 'firebase';
  const adapter = adapterRegistry.get(key);
  if (adapter) {
    return adapter();
  }

  if (key === 'demo') return new DemoTokenVerifier();
  if (key === 'firebase') return new FirebaseTokenVerifier();
  if (key === 'google') return new GoogleTokenVerifier(requireEnv('GOOGLE_CLIENT_ID'));
  if (key === 'apple') return new AppleTokenVerifier();
  if (key === 'oidc') {
    return new GenericOidcTokenVerifier({
      issuer: requireEnv('OIDC_ISSUER'),
      audience: requireEnv('OIDC_AUDIENCE'),
      jwksUri: requireEnv('OIDC_JWKS_URI'),
    });
  }

  throw new Error(
    `Unsupported AUTH_TOKEN_VERIFIER='${key}'. Allowed built-ins: demo,firebase,google,apple,oidc.`
  );
}

