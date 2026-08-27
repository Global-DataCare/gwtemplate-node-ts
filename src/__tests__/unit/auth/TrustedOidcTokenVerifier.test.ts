// Flow contract: route only by the unverified iss hint, then accept a token only after its configured verifier validates exact issuer and audience.
// src/__tests__/unit/auth/TrustedOidcTokenVerifier.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier } from '../../../auth/ITokenVerifier';
import { TrustedOidcTokenVerifier } from '../../../auth/TrustedOidcTokenVerifier';

function unsignedToken(payload: Record<string, unknown>): string {
  return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('TrustedOidcTokenVerifier', () => {
  it('delegates to the verifier bound to the token issuer', async () => {
    const gdcVerifier: ITokenVerifier = {
      verify: jest.fn().mockResolvedValue({ valid: true, payload: { iss: 'globaldatacare.es' } }),
    };
    const firebaseVerifier: ITokenVerifier = {
      verify: jest.fn().mockResolvedValue({ valid: true, payload: { iss: 'https://securetoken.google.com/unid-production' } }),
    };
    const verifier = new TrustedOidcTokenVerifier([
      { issuer: 'globaldatacare.es', verifier: gdcVerifier },
      { issuer: 'https://securetoken.google.com/unid-production', verifier: firebaseVerifier },
    ]);

    const result = await verifier.verify(unsignedToken({ iss: 'globaldatacare.es' }));

    expect(result.valid).toBe(true);
    expect(gdcVerifier.verify).toHaveBeenCalledTimes(1);
    expect(firebaseVerifier.verify).not.toHaveBeenCalled();
  });

  it('rejects an issuer that is not configured without trying another provider', async () => {
    const configuredVerifier: ITokenVerifier = { verify: jest.fn() };
    const verifier = new TrustedOidcTokenVerifier([
      { issuer: 'globaldatacare.es', verifier: configuredVerifier },
    ]);

    const result = await verifier.verify(unsignedToken({ iss: 'https://attacker.example' }));

    expect(result).toEqual({ valid: false, error: 'Untrusted id_token issuer.' });
    expect(configuredVerifier.verify).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens before provider selection', async () => {
    const verifier = new TrustedOidcTokenVerifier([]);

    await expect(verifier.verify('not-a-jwt')).resolves.toEqual({
      valid: false,
      error: 'Invalid id_token structure.',
    });
  });
});
