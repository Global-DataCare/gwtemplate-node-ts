import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { extractRepresentativeCredentialBinding } from 'gdc-common-utils-ts/utils/activation-policy';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { getClaimValue } from '../utils/claims';
import { summarizeProfessionalIdentityCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { summarizeIndividualMemberIdentityCredential } from 'gdc-common-utils-ts/utils/individual-smart';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, type JSONWebKeySet, type JWK } from 'jose';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { verifyPinnedDetachedJws, verifyPinnedJwt, type IClearingHouseService, type ClearingHouseVerificationRequest, type ClearingHouseVerificationResult } from './ClearingHouseService';

/** In-process facts established by signature and current-state checks; never accepted from a request body. */
export type VerifiedPresentationIdentity = {
  actorDid: string; acr: string; subjectDid?: string; role?: string;
  email?: string; phone?: string; sameAs?: readonly string[];
};

/** Current-state verifier. No network label, missing status or decodable token is a positive verification. */
export class LedgerPresentationVerifier implements IClearingHouseService {
  constructor(private readonly options: {
    network: string;
    ledgerKind: 'memory' | 'fabric';
    ledger: ICredentialLedgerAdapter;
    cryptography?: ICryptography;
    now?: () => number;
    channelName?: string;
    resolveHolderKeys: (holder: string, tenantDid: string, request: ClearingHouseVerificationRequest) => Promise<JSONWebKeySet>;
    resolveIssuerKeys: (issuer: string) => Promise<JSONWebKeySet>;
    assertActiveKey: (owner: string, key: JWK, request: ClearingHouseVerificationRequest) => Promise<void>;
    verifyRegisteredIdentity?: (credential: Record<string, any>, holder: string, key: JWK, request: ClearingHouseVerificationRequest) => Promise<VerifiedPresentationIdentity>;
    authorize: (request: ClearingHouseVerificationRequest, identity?: VerifiedPresentationIdentity) => Promise<void>;
  }) {}

  async verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult> {
    if (this.options.network !== 'test' && this.options.ledgerKind !== 'fabric') throw new Error('Network verification requires the authoritative Fabric ledger.');
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const tenantDid = String(request.tenantDid || '');
    if (!tenantDid) throw new Error('Presentation verification requires the trusted tenant.');
    const unverified = decodeJwt(request.vpToken);
    const unverifiedVp = (unverified.vp || unverified) as Record<string, any>;
    const projection = Array.isArray(unverifiedVp.verifiableCredential) && unverifiedVp.verifiableCredential.some((value: any) => value && typeof value === 'object' && !value.issuer && !value.iss && !value.proof && (summarizeProfessionalIdentityCredential(value) || summarizeIndividualMemberIdentityCredential(value)));
    const holder = String(unverifiedVp.holder || unverified.iss || '');
    if (projection && (!request.authenticatedClientId || request.authenticatedClientId !== holder)) throw new Error('Registered identity projection requires fresh authenticated client context.');
    const holderKeys = await this.options.resolveHolderKeys(holder, tenantDid, request);
    const header = decodeProtectedHeader(request.vpToken);
    const holderKey = holderKeys.keys.find(key => key.kid === header.kid);
    if (!holderKey) throw new Error('Holder signing key is not registered.');
    await this.options.assertActiveKey(holder, holderKey, request);
    const issuer = String(unverified.iss || '');
    if (projection && issuer !== holder && issuer !== header.kid) throw new Error('Wallet presentation issuer does not match its registered client or signing key.');
    const payload = await verifyPinnedJwt(request.vpToken, holderKeys, issuer, now, {
      audience: projection && unverified.aud === undefined ? undefined : request.tokenIssuer || tenantDid,
      cryptography: this.options.cryptography, requireJwtTimes: !projection,
    });
    const vp = (payload.vp || payload) as Record<string, any>;
    if (!Array.isArray(vp.verifiableCredential) || vp.verifiableCredential.length === 0) throw new Error('Presentation contains no credentials.');
    let issuerKeysChecked = true;
    const subjects = new Set<string>();
    const provedAssurance = new Set<string>();
    const verifiedIdentities = new Map<string, VerifiedPresentationIdentity>();
    const rememberIdentity = (identity: VerifiedPresentationIdentity) => {
      const previous = verifiedIdentities.get(identity.acr);
      if (previous && (previous.actorDid !== identity.actorDid || previous.subjectDid !== identity.subjectDid || previous.role !== identity.role)) throw new Error('Presentation contains ambiguous actor authority.');
      verifiedIdentities.set(identity.acr, identity);
    };
    for (const input of vp.verifiableCredential) {
      let credential: Record<string, any>;
      let compact: string | undefined;
      if (typeof input === 'string') compact = input;
      else if (typeof input?.id === 'string' && input.id.startsWith('data:application/vc+jwt,')) compact = input.id.slice('data:application/vc+jwt,'.length);
      credential = compact ? decodeJwt(compact) as Record<string, any> : input;
      const issuer = String(credential.iss || (typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id) || '');
      if (!issuer) {
        if (compact || credential.proof || !projection || !this.options.verifyRegisteredIdentity) throw new Error('Credential issuer or authoritative registered identity verifier is missing.');
        const identity = await this.options.verifyRegisteredIdentity(credential, holder, holderKey, request);
        if (request.tokenSubject && identity.actorDid !== request.tokenSubject) throw new Error('Registered identity does not match the professional subject.');
        subjects.add(identity.actorDid); provedAssurance.add(identity.acr); issuerKeysChecked = false;
        rememberIdentity(identity);
        continue;
      }
      const keys = await this.options.resolveIssuerKeys(issuer);
      const proof = Array.isArray(credential.proof) ? credential.proof[0] : credential.proof;
      const keyId = compact ? decodeProtectedHeader(compact).kid : proof?.verificationMethod;
      const candidates = keys.keys.filter(candidate => candidate.kid === keyId || `${issuer}#${candidate.kid}` === keyId);
      const key = candidates.length === 1 ? candidates[0] : undefined;
      if (!key) throw new Error('Credential issuer signing key is not trusted.');
      await this.options.assertActiveKey(issuer, key, request);
      if (compact) {
        const verified = await verifyPinnedJwt(compact, keys, issuer, now, { cryptography: this.options.cryptography, requireJwtTimes: false });
        credential = (verified.vc || verified) as Record<string, any>;
      } else {
        if (typeof proof?.jws !== 'string') throw new Error('Credential requires a verifiable issuer signature.');
        const proofHeader = decodeProtectedHeader(proof.jws);
        if (proofHeader.kid && proofHeader.kid !== key.kid && proofHeader.kid !== keyId) throw new Error('Issuer signature verification-method mismatch.');
        if (proof.proofPurpose && proof.proofPurpose !== 'assertionMethod') throw new Error('Unexpected issuer signature purpose.');
        const unsigned = { ...credential }; delete unsigned.proof;
        await verifyPinnedDetachedJws(new TextEncoder().encode(canonicalize(unsigned)!), proof.jws, key, this.options.cryptography);
      }
      for (const date of [credential.validFrom, credential.issuanceDate]) {
        if (date !== undefined && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || Date.parse(date) > now * 1000)) throw new Error('Credential is not valid yet.');
      }
      for (const date of [credential.validUntil, credential.expirationDate]) {
        if (date !== undefined && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || Date.parse(date) <= now * 1000)) throw new Error('Credential has expired.');
      }
      const id = String(credential.id || credential.jti || '');
      if (!id) throw new Error('Credential identifier is missing.');
      const status = await this.options.ledger.getCredentialStatus(id, this.options.network, { channelName: this.options.channelName });
      if (!status || status.status !== 'active' || (status.issuer && status.issuer !== issuer)
        || (status.expiresAt != null && status.expiresAt <= now)) throw new Error('Credential is not currently active on the authoritative ledger.');
      const professional = summarizeProfessionalIdentityCredential(credential);
      const individual = summarizeIndividualMemberIdentityCredential(credential);
      if (professional || individual) {
        const material = getClaimValue(credential.credentialSubject || {}, ClaimsPersonSchemaorg.hasCredentialMaterial)
          || extractRepresentativeCredentialBinding(credential);
        if (material !== toJwkThumbprintSha256Urn(holderKey as any)) throw new Error('Credential holder key binding does not match the presentation signer.');
      }
      if (professional && (!request.tokenSubject || professional.actorDid === request.tokenSubject)) {
        const acr = 'urn:antifraud:acr:openid4vp:employee'; provedAssurance.add(acr);
        rememberIdentity({ actorDid: professional.actorDid, acr, role: professional.role, sameAs: professional.sameAs });
      }
      if (individual && (!request.tokenSubject || individual.actorDid === request.tokenSubject)) {
        const acr = 'urn:antifraud:acr:openid4vp:individual'; provedAssurance.add(acr);
        rememberIdentity({ actorDid: individual.actorDid, acr, subjectDid: individual.subjectDid, role: individual.relationship, sameAs: individual.sameAs });
      }
      for (const subject of Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject]) {
        if (subject?.id) subjects.add(subject.id);
        for (const alias of Array.isArray(subject?.sameAs) ? subject.sameAs : [subject?.sameAs]) if (typeof alias === 'string') subjects.add(alias);
      }
    }
    const acr = typeof payload.acr === 'string' ? payload.acr : projection ? request.acrValues.find(value => provedAssurance.has(value)) : undefined;
    if (!acr || !request.acrValues.includes(acr)) throw new Error('Presentation does not prove the requested assurance context.');
    if (!provedAssurance.has(acr)) throw new Error('Issuer-signed credentials do not prove the requested professional assurance.');
    if (request.tokenSubject && !subjects.has(request.tokenSubject)) throw new Error('Credential subject does not match the professional.');
    if (request.tokenScope) await this.options.authorize(request, verifiedIdentities.get(acr));
    return { acr, amr: ['openid4vp', 'vc'], vpHash: createHash('sha256').update(request.vpToken).digest('hex'), ledgerVerified: true,
      trustChecks: { revocationChecked: true, issuerKeyStatusChecked: issuerKeysChecked, subjectKeyStatusChecked: true, onChainChecked: this.options.ledgerKind === 'fabric' } };
  }
}
