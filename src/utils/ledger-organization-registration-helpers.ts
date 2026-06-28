import { createHash } from 'crypto';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';

export function tryGetJwkThumbprint(jwk?: PublicJwk): string | undefined {
  if (!jwk) return undefined;
  try {
    return toJwkThumbprintSha256Urn(jwk);
  } catch {
    return undefined;
  }
}

export function inferLedgerJwkUse(jwk: PublicJwk): 'sig' | 'enc' {
  const explicitUse = String((jwk as any)?.use || '').trim().toLowerCase();
  if (explicitUse === 'enc') return 'enc';
  const alg = String((jwk as any)?.alg || '').trim().toUpperCase();
  if (alg.startsWith('ECDH') || alg.startsWith('ML-KEM')) return 'enc';
  return 'sig';
}

export function hashLedgerString(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
