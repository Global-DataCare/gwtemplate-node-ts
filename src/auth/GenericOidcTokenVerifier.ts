// src/auth/GenericOidcTokenVerifier.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ITokenVerifier, VerificationResult } from './ITokenVerifier';

export type GenericOidcConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
};

export class GenericOidcTokenVerifier implements ITokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwksUri: string;

  constructor(config: GenericOidcConfig) {
    this.issuer = config.issuer;
    this.audience = config.audience;
    this.jwksUri = config.jwksUri;
  }

  public async verify(token: string): Promise<VerificationResult> {
    try {
      const jwks = createRemoteJWKSet(new URL(this.jwksUri));
      const { payload } = await jwtVerify(token, jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });
      return { valid: true, payload };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}

