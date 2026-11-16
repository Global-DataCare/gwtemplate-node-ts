import canonicalize from 'canonicalize';
import { isLocalDemoSecurityMode } from '../security/runtime-security-policy';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { TrustRegistryVerificationResult } from '../adapters/trust-registry.adapter';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, flattenedVerify, importJWK, type JWK, type JSONWebKeySet, type JWTPayload } from 'jose';
import { assertTenantClearingHouseTrust, resolveConfiguredClearingHouseTrust, type TenantClearingHouseTrust } from './tenant-clearing-house-trust';

export type ClearingHouseVerificationRequest = {
  tenantDid?: string;
  /** Trusted in-process routing context; never serialized into backend requests. */
  tenantVaultId?: string;
  /** Supplied only after registered client authentication or verified index-token validation. */
  authenticatedClientId?: string;
  /** Internal owner of the existing DCR; never accepted from backend request bodies. */
  holderVaultId?: string;
  vpToken: string;
  presentationSubmission?: unknown;
  acrValues: string[];
  tokenIssuer?: string;
  tokenSubject?: string;
  tokenScope?: string;
  tokenPurpose?: string;
  consentIdentifiers?: string[];
};
export type ClearingHouseVerificationResult = {
  /** Native, in-process activation authority. Remote receipts never populate this field. */
  activationEvidenceSource?: 'ica';
  acr: string; amr?: string[]; vpHash?: string; ledgerVerified: boolean; trustChecks?: TrustRegistryVerificationResult };
export interface IClearingHouseService {
  verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult>;
}

const SIGNATURE_ALGORITHMS = ['ES256', 'ES384', 'ES512', 'RS256', 'PS256', 'EdDSA', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87'];

/** Verifies a pinned issuer's signature; embedded keys never establish trust. */
export async function verifyPinnedJwt(
  compact: string, jwks: JSONWebKeySet, issuer: string, now: number,
  options: { audience?: string; cryptography?: ICryptography; requireJwtTimes?: boolean; allowMissingKid?: boolean } = {},
): Promise<JWTPayload> {
  const header = decodeProtectedHeader(compact);
  if (header.crit !== undefined || header.b64 === false) {
    throw new Error('Unsupported critical JWT extension or payload encoding.');
  }
  if (!SIGNATURE_ALGORITHMS.includes(String(header.alg))) {
    throw new Error('Unsupported signed Clearing House JWT algorithm.');
  }
  const keys = jwks.keys.filter(key => (header.kid ? key.kid === header.kid : options.allowMissingKid === true) && (!key.use || key.use === 'sig') && (!key.alg || key.alg === header.alg));
  if ((!header.kid && !options.allowMissingKid) || keys.length !== 1) throw new Error('Clearing House JWT signing key is not uniquely trusted.');
  let payload: JWTPayload;
  if (String(header.alg).startsWith('ML-DSA-')) {
    if (!options.cryptography) throw new Error('PQC JWT verifier is not configured.');
    if (!await options.cryptography.verifyJws(compact, keys[0] as any)) throw new Error('Invalid Clearing House JWT signature.');
    payload = decodeJwt(compact);
  } else {
    ({ payload } = await jwtVerify(compact, createLocalJWKSet({ keys }), { algorithms: [String(header.alg)], currentDate: new Date(now * 1000) }));
  }
  // VC-JOSE can carry the W3C issuer object instead of duplicating it as iss.
  // This alternative applies only to the credential profile, never bearer JWTs.
  const credentialIssuer = typeof payload.issuer === 'string' ? payload.issuer
    : options.requireJwtTimes === false && payload.issuer && typeof payload.issuer === 'object'
      ? (payload.issuer as { id?: unknown }).id : undefined;
  if ((payload.iss ?? credentialIssuer) !== issuer) throw new Error('Clearing House JWT issuer mismatch.');
  if (options.audience && payload.aud !== options.audience) throw new Error('Clearing House JWT audience mismatch.');
  if (options.requireJwtTimes !== false && (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || !payload.jti)) {
    throw new Error('Clearing House JWT requires issued-at, expiry and unique identifier.');
  }
  if ((payload.exp !== undefined && (typeof payload.exp !== 'number' || payload.exp <= now))
    || (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now))
    || (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat > now + 30))) {
    throw new Error('Clearing House JWT is outside its validity period.');
  }
  return payload;
}

/** Verifies the detached issuer proof over the canonical unsigned credential. */
export async function verifyPinnedDetachedJws(bytes: Uint8Array, compact: string, key: JWK, cryptography?: ICryptography): Promise<void> {
  const parts = compact.split('.');
  if (parts.length !== 3 || !parts[0] || parts[1] !== '' || !parts[2]) throw new Error('Invalid detached issuer signature.');
  const header = decodeProtectedHeader(compact);
  const algorithm = String(header.alg || '');
  if (!SIGNATURE_ALGORITHMS.includes(algorithm) || (key.alg && key.alg !== algorithm) || (key.use && key.use !== 'sig')) throw new Error('Unsupported detached issuer signature algorithm or key.');
  if (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.some(value => value !== 'b64')))
    throw new Error('Unsupported critical issuer signature extension.');
  if (algorithm.startsWith('ML-DSA-')) {
    if (!cryptography || !await cryptography.verifyDetachedJws(bytes, compact, key as any)) throw new Error('Invalid detached issuer signature.');
    return;
  }
  await flattenedVerify({ protected: parts[0], payload: header.b64 === false ? bytes : Buffer.from(bytes).toString('base64url'), signature: parts[2] },
    await importJWK(key, algorithm), { algorithms: [algorithm] });
}

export class ClearingHouseService implements IClearingHouseService {
  constructor(private readonly options: {
    resolveTrust?: (tenantDid: string) => TenantClearingHouseTrust | Promise<TenantClearingHouseTrust>;
    now?: () => number;
    cryptography?: ICryptography;
    allowLocalTestEndpoint?: boolean;
    localVerifier?: IClearingHouseService;
    signClientAssertion?: (input: { tenantDid: string; tenantVaultId?: string; audience: string; requestHash: string }) => Promise<string>;
  } = {}) {}

  async verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult> {
    const mode = (process.env.CLEARING_HOUSE_MODE || (isLocalDemoSecurityMode() ? 'stub' : this.options.localVerifier ? 'local' : 'remote')).toLowerCase();
    if (mode === 'local') {
      if (!this.options.localVerifier) throw new Error('Local Clearing House verifier is not configured.');
      return this.options.localVerifier.verifyVpToken(request);
    }
    const hash = createHash('sha256').update(request.vpToken).digest('hex');
    if (mode === 'stub' && isLocalDemoSecurityMode()) {
      return { acr: request.acrValues[0], amr: ['openid4vp', 'vc'], vpHash: hash, ledgerVerified: true };
    }
    if (mode !== 'remote') throw new Error('Unsupported Clearing House mode: simulation is restricted to explicit local demo.');
    const tenantDid = String(request.tenantDid || '').trim();
    const trust = await (this.options.resolveTrust || resolveConfiguredClearingHouseTrust)(tenantDid);
    const endpoint = assertTenantClearingHouseTrust(trust, tenantDid, this.options.allowLocalTestEndpoint);
    const nonce = randomUUID();
    const body = JSON.stringify({ nonce, tenant_did: tenantDid, vp_token: request.vpToken, presentation_submission: request.presentationSubmission,
      acr_values: request.acrValues, token_issuer: request.tokenIssuer, token_subject: request.tokenSubject,
      token_scope: request.tokenScope, client_id: request.authenticatedClientId, token_purpose: request.tokenPurpose, consent_identifiers: request.consentIdentifiers });
    if (!this.options.signClientAssertion) throw new Error('Signed Clearing House request authentication is not configured.');
    const assertion = await this.options.signClientAssertion({ tenantDid, tenantVaultId: request.tenantVaultId, audience: endpoint.href,
      requestHash: createHash('sha256').update(canonicalize(JSON.parse(body))!).digest('hex') });
    const response = await fetch(endpoint, {
      method: HttpRequestMethods.Post, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', accept: 'application/jwt', authorization: `Bearer ${assertion}` }, body,
    });
    if (!response.ok) throw new Error(`Clearing House verification failed (${response.status}).`);
    const compact = (await response.text()).trim();
    if (compact.length > 1_048_576 || compact.split('.').length !== 3) throw new Error('Clearing House requires a signed JWT response.');
    const payload = await verifyPinnedJwt(compact, trust.jwks, trust.issuer, this.options.now?.() ?? Math.floor(Date.now() / 1000), {
      audience: trust.audience, cryptography: this.options.cryptography,
    });
    if (payload.nonce !== nonce) throw new Error('Clearing House receipt nonce does not match this verification request.');
    if (payload.ledger_verified !== true || payload.vp_hash !== hash || typeof payload.acr !== 'string'
      || !request.acrValues.includes(payload.acr) || !Array.isArray(payload.amr) || payload.amr.length === 0
      || !payload.amr.every(value => typeof value === 'string')) {
      throw new Error('Clearing House did not positively verify this presentation and assurance context.');
    }
    const bindings: Array<[unknown, unknown]> = [[request.tokenIssuer, payload.token_issuer], [request.tokenSubject, payload.token_subject],
      [request.tokenScope, payload.token_scope], [request.authenticatedClientId, payload.client_id], [request.tokenPurpose, payload.token_purpose], [request.consentIdentifiers, payload.consent_identifiers]];
    if (bindings.some(([expected, actual]) => expected !== undefined && JSON.stringify(expected) !== JSON.stringify(actual))) {
      throw new Error('Clearing House result does not match the requested authorization context.');
    }
    return { acr: payload.acr, amr: payload.amr as string[], vpHash: hash, ledgerVerified: true, trustChecks: payload.trust_checks as TrustRegistryVerificationResult | undefined };
  }
}
