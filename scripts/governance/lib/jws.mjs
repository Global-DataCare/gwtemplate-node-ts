import {
  constants as cryptoConstants,
  createPublicKey,
  createVerify,
  verify as verifyRaw,
} from 'node:crypto';

function decodeBase64Url(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`JWS ${label} is empty.`);
  return Buffer.from(value, 'base64url');
}

function verificationMethods(didDocument) {
  return Array.isArray(didDocument?.verificationMethod) ? didDocument.verificationMethod : [];
}

function isAssertionMethod(didDocument, kid) {
  const methods = Array.isArray(didDocument?.assertionMethod) ? didDocument.assertionMethod : [];
  return methods.some((entry) => (typeof entry === 'string' ? entry : entry?.id) === kid);
}

async function verifyMlDsa(alg, signature, data, jwk) {
  const module = await import('@noble/post-quantum/ml-dsa.js');
  const verifier = {
    'ML-DSA-44': module.ml_dsa44,
    'ML-DSA-65': module.ml_dsa65,
    'ML-DSA-87': module.ml_dsa87,
  }[alg];
  if (!verifier) throw new Error(`Unsupported ML-DSA algorithm "${alg}".`);
  const publicKey = Buffer.from(jwk.pub || jwk.x || '', 'base64url');
  return verifier.verify(signature, data, publicKey);
}

function verifyClassical(alg, signature, data, jwk) {
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (alg === 'EdDSA') return verifyRaw(null, data, key, signature);
  const digest = alg === 'ES384' ? 'sha384' : 'sha256';
  const verifier = createVerify(digest);
  verifier.update(data);
  verifier.end();
  if (alg === 'PS256') {
    return verifier.verify({
      key,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, signature);
  }
  if (alg === 'ES256K' || alg === 'ES256' || alg === 'ES384') {
    return verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
  }
  if (alg === 'RS256') return verifier.verify(key, signature);
  throw new Error(`Unsupported JWS algorithm "${alg}".`);
}

function decodeJsonSegment(value, label) {
  try {
    return JSON.parse(decodeBase64Url(value, label).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

/**
 * Verifies a compact VC-JWT against the exact assertion method published by a
 * trusted issuer DID. The caller remains responsible for semantic credential
 * checks and current status/revocation policy.
 */
export function verifyVcJwt({ jwt, didDocument, expectedIssuer, now = Date.now() }) {
  const [headerEncoded, payloadEncoded, signatureEncoded, extra] = String(jwt || '').split('.');
  if (extra !== undefined || !headerEncoded || !payloadEncoded || !signatureEncoded) {
    throw new Error('Host credential must be a compact signed VC-JWT.');
  }
  const header = decodeJsonSegment(headerEncoded, 'VC-JWT protected header');
  const payload = decodeJsonSegment(payloadEncoded, 'VC-JWT payload');
  if (payload.iss !== expectedIssuer || didDocument?.id !== expectedIssuer) {
    throw new Error('Host credential issuer does not match the trusted ICA DID.');
  }
  if (typeof header.kid !== 'string' || !header.kid.startsWith(`${expectedIssuer}#`)) {
    throw new Error('Host credential kid must belong to its issuer DID.');
  }
  const method = verificationMethods(didDocument).find((entry) => entry?.id === header.kid);
  if (!method?.publicKeyJwk || !isAssertionMethod(didDocument, header.kid)) {
    throw new Error('Host credential kid is not an issuer assertionMethod.');
  }
  const jwk = method.publicKeyJwk;
  if (jwk.alg && jwk.alg !== header.alg) {
    throw new Error('Host credential JWS alg does not match the issuer JWK.');
  }
  const allowedAlgorithms = new Set(['ES384', 'ES256K', 'ES256', 'RS256', 'PS256', 'EdDSA']);
  if (!allowedAlgorithms.has(header.alg)) {
    throw new Error('Host credential uses an unsupported JWS algorithm.');
  }
  const valid = verifyClassical(
    header.alg,
    decodeBase64Url(signatureEncoded, 'host credential signature'),
    Buffer.from(`${headerEncoded}.${payloadEncoded}`),
    jwk,
  );
  if (!valid) throw new Error('Invalid Host VC-JWT signature.');
  const nowSeconds = Math.floor(now / 1000);
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds) {
    throw new Error('Host credential is not active yet.');
  }
  if (Number.isFinite(payload.exp) && payload.exp <= nowSeconds) {
    throw new Error('Host credential has expired.');
  }
  return { header, payload };
}

/**
 * Verifies the current application identity token independently from the
 * controller signature. The token is compared with the signed operator claims
 * but is never returned for persistence or audit.
 */
export function verifyOperatorIdentityToken({
  jwt,
  jwks,
  expected,
  allowedAudiences,
  now = Date.now(),
}) {
  const [headerEncoded, payloadEncoded, signatureEncoded, extra] = String(jwt || '').split('.');
  if (extra !== undefined || !headerEncoded || !payloadEncoded || !signatureEncoded) {
    throw new Error('Operator identity token must be a compact signed JWT.');
  }
  const header = decodeJsonSegment(headerEncoded, 'Identity token protected header');
  const payload = decodeJsonSegment(payloadEncoded, 'Identity token payload');
  const allowedAlgorithms = new Set(['RS256', 'PS256', 'ES256', 'ES384', 'EdDSA']);
  if (!allowedAlgorithms.has(header.alg)) throw new Error('Identity token uses an unsupported algorithm.');
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('Identity token kid is required.');
  const jwk = (Array.isArray(jwks?.keys) ? jwks.keys : []).find((entry) => entry?.kid === header.kid);
  if (!jwk) throw new Error('Identity token kid is absent from trusted JWKS.');
  if (jwk.alg && jwk.alg !== header.alg) throw new Error('Identity token alg does not match trusted JWK.');
  const valid = verifyClassical(
    header.alg,
    decodeBase64Url(signatureEncoded, 'identity token signature'),
    Buffer.from(`${headerEncoded}.${payloadEncoded}`),
    jwk,
  );
  if (!valid) throw new Error('Invalid operator identity token signature.');
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw new Error('Operator identity token has expired.');
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds) throw new Error('Operator identity token is not active.');
  if (payload.iss !== expected.issuer) throw new Error('Operator identity token issuer does not match decision.');
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !Array.isArray(allowedAudiences)
    || !allowedAudiences.length
    || !tokenAudiences.some((audience) => allowedAudiences.includes(audience))
  ) {
    throw new Error('Operator identity token audience is not trusted by reconciler inventory.');
  }
  if (payload.sub !== expected.subject) throw new Error('Operator identity token subject does not match decision.');
  if (payload.email_verified !== true) throw new Error('Operator identity token email must be verified.');
  if (String(payload.email || '').toLowerCase() !== expected.email.toLowerCase()) {
    throw new Error('Operator identity token email does not match decision.');
  }
  const tenantId = payload.tenant_id || payload.tid || payload.firebase?.tenant;
  if (tenantId !== expected.tenantId) throw new Error('Operator identity token tenant does not match decision.');
  const authenticatedAt = Date.parse(expected.authenticatedAt);
  if (!Number.isFinite(payload.iat) || Math.abs(payload.iat * 1000 - authenticatedAt) > 60_000) {
    throw new Error('Operator identity token issued-at does not match decision authentication time.');
  }
  return {
    issuer: payload.iss,
    subject: payload.sub,
    email: payload.email,
    tenantId,
    issuedAt: Number.isFinite(payload.iat) ? payload.iat : undefined,
    expiresAt: payload.exp,
  };
}

/**
 * Verifies a detached compact JWS over the canonical decision bytes. The key
 * must be the exact assertionMethod selected by the signed decision.
 */
export async function verifyControllerJws({ jws, payload, didDocument, controllerDid, controllerKid }) {
  if (didDocument?.id !== controllerDid) {
    throw new Error('Controller DID document id does not match the signed decision.');
  }
  const [protectedEncoded, payloadEncoded, signatureEncoded, extra] = String(jws || '').split('.');
  if (extra !== undefined || !protectedEncoded || payloadEncoded !== '' || !signatureEncoded) {
    throw new Error('Approval must be a detached compact JWS with exactly three segments.');
  }
  let header;
  try {
    header = JSON.parse(decodeBase64Url(protectedEncoded, 'protected header').toString('utf8'));
  } catch (error) {
    throw new Error(`JWS protected header is invalid JSON: ${error.message}`);
  }
  if (header.kid !== controllerKid) throw new Error('JWS kid does not match decision controllerKid.');
  if (header.b64 === false) throw new Error('Unencoded JWS payloads are not supported.');
  const method = verificationMethods(didDocument).find((entry) => entry?.id === controllerKid);
  if (!method?.publicKeyJwk || !isAssertionMethod(didDocument, controllerKid)) {
    throw new Error('Controller kid is not a DID assertionMethod with publicKeyJwk.');
  }
  const jwk = method.publicKeyJwk;
  if (jwk.kid && jwk.kid !== controllerKid && !controllerKid.endsWith(`#${jwk.kid}`)) {
    throw new Error('DID verification method JWK kid does not match controllerKid.');
  }
  if (jwk.alg && jwk.alg !== header.alg) throw new Error('JWS alg does not match controller JWK.');
  const signingInput = Buffer.from(`${protectedEncoded}.${Buffer.from(payload).toString('base64url')}`);
  const signature = decodeBase64Url(signatureEncoded, 'signature');
  const valid = String(header.alg).startsWith('ML-DSA-')
    ? await verifyMlDsa(header.alg, signature, signingInput, jwk)
    : verifyClassical(header.alg, signature, signingInput, jwk);
  if (!valid) throw new Error('Invalid controller governance signature.');
  return { alg: header.alg, kid: header.kid };
}
