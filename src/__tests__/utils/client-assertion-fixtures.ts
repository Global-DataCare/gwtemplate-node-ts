import { generateKeyPairSync } from 'node:crypto';
import { exportJWK, SignJWT } from 'jose';

/**
 * Builds one ephemeral ES384 client-authentication JWT for SMART token tests.
 *
 * The public JWK is embedded in the protected header so GW can verify the
 * signature without external JWKS infrastructure.
 */
export async function createClientAssertion(params: {
  clientId: string;
  audience: string;
}): Promise<string> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const publicJwk = await exportJWK(publicKey);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES384', typ: 'JWT', jwk: publicJwk })
    .setIssuer(params.clientId)
    .setSubject(params.clientId)
    .setAudience(params.audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}
