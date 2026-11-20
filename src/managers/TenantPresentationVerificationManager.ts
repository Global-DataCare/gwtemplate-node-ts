import canonicalize from 'canonicalize';
import { createHash, randomUUID } from 'node:crypto';
import { decodeJwt, type JSONWebKeySet } from 'jose';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { ITenantsManager } from './ITenantsManager';
import type { IReplayProtectionStore } from '../adapters/replay-protection-store';
import { verifyPinnedJwt, type IClearingHouseService } from '../services/ClearingHouseService';
import { getTenantVaultId } from '../utils/tenant';

export type OrganizationControllerPresentationRequest = Readonly<{
  vaultId: string;
  tenantId: string;
  tenantDid: string;
  jurisdiction: string;
  sector: string;
  audience: string;
  vpToken: string;
}>;

export type VerifiedOrganizationControllerPresentation = Readonly<{ issuer: string; id: string; expiresAt: number }>;

export type ClearingHouseRequesterTrust = Readonly<{ jwks: JSONWebKeySet; capabilities: readonly string[] }>;

/** Backend-to-backend verification. Caller identity, request integrity and current state are independent gates. */
export class TenantPresentationVerificationManager {
  constructor(private readonly options: {
    tenants: ITenantsManager;
    verifier: IClearingHouseService;
    verifyOrganizationController?: (request: OrganizationControllerPresentationRequest) => Promise<VerifiedOrganizationControllerPresentation>;
    replay: IReplayProtectionStore;
    cryptography?: ICryptography;
    now?: () => number;
    resolveRequester: (recipient: string, requester: string) => ClearingHouseRequesterTrust | Promise<ClearingHouseRequesterTrust>;
    signResult: (vaultId: string, payload: Record<string, unknown>) => Promise<string>;
  }) {}

  async verify(input: { tenantId: string; jurisdiction: string; sector: string; requestUrl: string; assertion: string; body: Record<string, unknown> }): Promise<string> {
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const vaultId = getTenantVaultId(input.sector, input.tenantId);
    if (!await this.options.tenants.tenantExists(vaultId) || !await this.options.tenants.isTenantOperational(vaultId)) throw new Error('Verifier tenant is not active.');
    const recipient = (await this.options.tenants.getDidDocument(vaultId))?.id;
    if (!recipient) throw new Error('Verifier tenant identity is unavailable.');
    const requester = decodeJwt(input.assertion).iss;
    const profile = input.body.verification_profile;
    if (profile !== undefined && profile !== 'organization-controller') throw new Error('Unknown verification profile.');
    const organizationController = profile === 'organization-controller';
    if (!requester || (!organizationController && input.body.tenant_did !== requester)) {
      throw new Error('Requesting verifier identity mismatch.');
    }
    const trust = await this.options.resolveRequester(recipient, requester);
    const capability = organizationController ? 'organization-controller-verifier' : 'verifier';
    if (!trust.capabilities.includes(capability)) throw new Error(`Requester lacks the ${capability} capability.`);
    const assertion = await verifyPinnedJwt(input.assertion, trust.jwks, requester, now, {
      audience: input.requestUrl, cryptography: this.options.cryptography,
    });
    if (assertion.sub !== requester || assertion.exp! - assertion.iat! > 120 || assertion.exp! <= assertion.iat!) throw new Error('Invalid backend request validity or subject.');
    const requestHash = createHash('sha256').update(canonicalize(input.body)!).digest('hex');
    if (assertion.request_hash !== requestHash) throw new Error('Backend request hash mismatch.');
    if (!await this.options.replay.reserveIfNotExists(`${vaultId}:presentation-verifier:${requester}:${assertion.jti}`, assertion.exp! - now)) throw new Error('Backend assertion replay detected.');
    const body = input.body;
    if (typeof body.nonce !== 'string' || !body.nonce || body.nonce.length > 256) throw new Error('Verification request requires a bounded nonce.');
    if (typeof body.vp_token !== 'string') throw new Error('Invalid presentation.');
    if (organizationController) {
      if (!body.vp_token || body.vp_token.length > 262_144) throw new Error('Invalid controller presentation length.');
      if (Object.keys(body).some(key => !['verification_profile', 'nonce', 'vp_token'].includes(key))) {
        throw new Error('Unexpected organization controller verification input.');
      }
      const verify = this.options.verifyOrganizationController;
      if (!verify) throw new Error('Organization controller verification is unavailable.');
      const verified = await verify({
        vaultId, tenantId: input.tenantId, tenantDid: recipient, jurisdiction: input.jurisdiction,
        sector: input.sector, audience: requester, vpToken: body.vp_token,
      });
      const checkedAt = this.options.now?.() ?? Math.floor(Date.now() / 1000);
      const ttl = verified.expiresAt - checkedAt;
      const presentationId = createHash('sha256').update(JSON.stringify([verified.issuer, verified.id])).digest('hex');
      if (ttl <= 0 || !await this.options.replay.reserveIfNotExists(
        `${vaultId}:organization-controller-presentation:${presentationId}`, ttl,
      )) throw new Error('Organization controller presentation replay or expiry.');
      return this.options.signResult(vaultId, {
        iss: recipient, aud: requester, sub: input.tenantId, iat: checkedAt, exp: checkedAt + Math.min(60, ttl), jti: randomUUID(),
        nonce: body.nonce, verified: true, verification_profile: profile, jurisdiction: input.jurisdiction, sector: input.sector,
        vp_hash: createHash('sha256').update(body.vp_token).digest('hex'),
      });
    }
    if (!Array.isArray(body.acr_values) || !body.acr_values.length || !body.acr_values.every(value => typeof value === 'string')) throw new Error('Invalid presentation request.');
    for (const name of ['token_issuer', 'token_subject', 'token_scope', 'token_purpose', 'client_id']) if (body[name] !== undefined && typeof body[name] !== 'string') throw new Error('Invalid authorization context.');
    if (body.consent_identifiers !== undefined && (!Array.isArray(body.consent_identifiers) || !body.consent_identifiers.every(value => typeof value === 'string'))) throw new Error('Invalid consent identifiers.');
    const result = await this.options.verifier.verifyVpToken({ tenantDid: recipient, tenantVaultId: vaultId, vpToken: body.vp_token,
      authenticatedClientId: body.client_id as string | undefined,
      acrValues: body.acr_values, presentationSubmission: body.presentation_submission,
      tokenIssuer: body.token_issuer as string | undefined, tokenSubject: body.token_subject as string | undefined,
      tokenScope: body.token_scope as string | undefined, tokenPurpose: body.token_purpose as string | undefined,
      consentIdentifiers: body.consent_identifiers as string[] | undefined,
    });
    const vpHash = createHash('sha256').update(body.vp_token).digest('hex');
    if (result.ledgerVerified !== true || result.vpHash !== vpHash || !body.acr_values.includes(result.acr) || !result.amr?.length) throw new Error('Presentation has no positive current-state result.');
    return this.options.signResult(vaultId, { iss: recipient, aud: requester, iat: now, exp: now + 60, jti: randomUUID(),
      nonce: body.nonce, acr: result.acr, amr: result.amr, vp_hash: vpHash, ledger_verified: true, trust_checks: result.trustChecks,
      token_issuer: body.token_issuer, token_subject: body.token_subject, token_scope: body.token_scope, client_id: body.client_id,
      token_purpose: body.token_purpose, consent_identifiers: body.consent_identifiers,
    });
  }
}
