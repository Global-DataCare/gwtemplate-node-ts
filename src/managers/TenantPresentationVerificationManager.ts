import canonicalize from 'canonicalize';
import { createHash, randomUUID } from 'node:crypto';
import { decodeJwt, type JSONWebKeySet } from 'jose';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { ITenantsManager } from './ITenantsManager';
import type { IReplayProtectionStore } from '../adapters/replay-protection-store';
import { verifyPinnedJwt, type IClearingHouseService } from '../services/ClearingHouseService';
import { getTenantVaultId } from '../utils/tenant';

export type ClearingHouseRequesterTrust = Readonly<{ jwks: JSONWebKeySet; capabilities: readonly string[] }>;

/** Backend-to-backend verification. Caller identity, request integrity and current state are independent gates. */
export class TenantPresentationVerificationManager {
  constructor(private readonly options: {
    tenants: ITenantsManager;
    verifier: IClearingHouseService;
    replay: IReplayProtectionStore;
    cryptography?: ICryptography;
    now?: () => number;
    resolveRequester: (recipient: string, requester: string) => ClearingHouseRequesterTrust | Promise<ClearingHouseRequesterTrust>;
    signResult: (vaultId: string, payload: Record<string, unknown>) => Promise<string>;
  }) {}

  async verify(input: { tenantId: string; sector: string; requestUrl: string; assertion: string; body: Record<string, unknown> }): Promise<string> {
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const vaultId = getTenantVaultId(input.sector, input.tenantId);
    if (!await this.options.tenants.tenantExists(vaultId) || !await this.options.tenants.isTenantOperational(vaultId)) throw new Error('Verifier tenant is not active.');
    const recipient = (await this.options.tenants.getDidDocument(vaultId))?.id;
    if (!recipient) throw new Error('Verifier tenant identity is unavailable.');
    const requester = decodeJwt(input.assertion).iss;
    if (!requester || input.body.tenant_did !== requester) throw new Error('Requesting tenant identity mismatch.');
    const trust = await this.options.resolveRequester(recipient, requester);
    if (!trust.capabilities.includes('verifier')) throw new Error('Requester has no verifier capability.');
    const assertion = await verifyPinnedJwt(input.assertion, trust.jwks, requester, now, {
      audience: input.requestUrl, cryptography: this.options.cryptography,
    });
    if (assertion.sub !== requester || assertion.exp! - assertion.iat! > 120 || assertion.exp! <= assertion.iat!) throw new Error('Invalid backend request validity or subject.');
    const requestHash = createHash('sha256').update(canonicalize(input.body)!).digest('hex');
    if (assertion.request_hash !== requestHash) throw new Error('Backend request hash mismatch.');
    if (!await this.options.replay.reserveIfNotExists(`${vaultId}:presentation-verifier:${requester}:${assertion.jti}`, assertion.exp! - now)) throw new Error('Backend assertion replay detected.');
    const body = input.body;
    if (typeof body.nonce !== 'string' || !body.nonce || body.nonce.length > 256) throw new Error('Verification request requires a bounded nonce.');
    if (typeof body.vp_token !== 'string' || !Array.isArray(body.acr_values) || !body.acr_values.length || !body.acr_values.every(value => typeof value === 'string')) throw new Error('Invalid presentation request.');
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
