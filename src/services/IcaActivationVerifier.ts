import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, type JSONWebKeySet, type JWK } from 'jose';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { ORGANIZATION_ACTIVATION_VC_TYPES, REPRESENTATIVE_ACTIVATION_VC_TYPES, SERVICE_CONTROLLER_ACTIVATION_VC_TYPES } from 'gdc-common-utils-ts/constants/verifiable-credentials';
import { extractRepresentativeCredentialBinding, validateActivationRepresentativePolicy } from 'gdc-common-utils-ts/utils/activation-policy';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { verifyPinnedDetachedJws, verifyPinnedJwt, type IClearingHouseService, type ClearingHouseVerificationRequest, type ClearingHouseVerificationResult } from './ClearingHouseService';

/** ICA-authorized first-controller verification does not depend on a previously enrolled device or Fabric. */
export class IcaActivationVerifier implements IClearingHouseService {
  constructor(private readonly options: {
    hostDid: string;
    cryptography?: ICryptography;
    allowLegacyRepresentativeBootstrap?: boolean;
    resolveIssuer: (issuer: string) => Promise<{ jwks: JSONWebKeySet; status: string }>;
    checkCredentialStatus: (credential: Record<string, any>) => Promise<{ status: string }>;
  }) {}

  async verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult> {
    if (request.tenantDid !== this.options.hostDid) throw new Error('Activation verifier audience must be the receiving host.');
    const now = Math.floor(Date.now() / 1000);
    const header = decodeProtectedHeader(request.vpToken);
    const actorKey = header.jwk as JWK | undefined;
    if (!actorKey || !actorKey.kid || actorKey.d || actorKey.k || actorKey.kty === 'oct') throw new Error('Activation presentation requires its public actor signing key.');
    // An embedded key proves possession only. Authority is established below by
    // the current ICA-signed controller credential's key binding.
    const issuer = decodeJwt(request.vpToken).iss;
    if (!issuer) throw new Error('Activation presentation issuer is missing.');
    const payload = await verifyPinnedJwt(request.vpToken, { keys: [actorKey] }, issuer, now,
      { audience: this.options.hostDid, cryptography: this.options.cryptography });
    if (payload.exp! - payload.iat! > 300) throw new Error('Activation presentation validity exceeds five minutes.');
    const inputs = (payload.vp as any)?.verifiableCredential;
    if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length > 8) throw new Error('Activation requires its ICA credential set.');
    const credentials: Record<string, any>[] = [];
    for (const input of inputs) {
      let compact: string | undefined;
      let credential: Record<string, any>;
      if (typeof input === 'string' && input.trim().startsWith('{')) credential = JSON.parse(input);
      else if (typeof input === 'string') { compact = input; const decoded = decodeJwt(input); credential = (decoded.vc || decoded) as Record<string, any>; }
      else credential = input;
      if (!credential || typeof credential !== 'object') throw new Error('Invalid activation credential.');
      const credentialIssuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
      if (!credentialIssuer || !credential.id) throw new Error('ICA credential issuer and identifier are required.');
      const trust = await this.options.resolveIssuer(credentialIssuer);
      if (trust.status !== 'active') throw new Error('ICA credential issuer is not active.');
      if (compact) {
        const verified = await verifyPinnedJwt(compact, trust.jwks, credentialIssuer, now, { requireJwtTimes: false, cryptography: this.options.cryptography });
        credential = (verified.vc || verified) as Record<string, any>;
      } else {
        const proof = Array.isArray(credential.proof) ? (credential.proof.length === 1 ? credential.proof[0] : undefined) : credential.proof;
        if (typeof proof?.jws !== 'string' || typeof proof.verificationMethod !== 'string'
          || (proof.proofPurpose && proof.proofPurpose !== 'assertionMethod')) throw new Error('ICA credential issuer proof is missing or unsupported.');
        const keys = trust.jwks.keys.filter(key => key.kid === proof.verificationMethod || `${credentialIssuer}#${key.kid}` === proof.verificationMethod);
        if (keys.length !== 1) throw new Error('ICA signing key is not uniquely trusted.');
        const proofHeader = decodeProtectedHeader(proof.jws);
        if (proofHeader.kid && proofHeader.kid !== keys[0].kid && proofHeader.kid !== proof.verificationMethod) throw new Error('ICA proof key does not match its verification method.');
        const unsigned = { ...credential }; delete unsigned.proof;
        await verifyPinnedDetachedJws(new TextEncoder().encode(canonicalize(unsigned)!), proof.jws, keys[0], this.options.cryptography);
      }
      const starts = [credential.validFrom, credential.issuanceDate].filter(value => value !== undefined);
      const ends = [credential.validUntil, credential.expirationDate].filter(value => value !== undefined);
      // W3C validity end dates are optional; original ICA credentials can rely
      // on current issuer-controlled status. Never invent or rewrite expiry.
      if (!starts.length || starts.some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now * 1000)
        || ends.some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now * 1000)) throw new Error('ICA credential is outside its validity period.');
      if ((await this.options.checkCredentialStatus(credential)).status !== 'good') throw new Error('ICA credential status is not active.');
      credentials.push(credential);
    }
    const select = (types: readonly string[]) => {
      const matches = credentials.filter(credential => (Array.isArray(credential.type) ? credential.type : [credential.type]).some((type: string) => types.includes(type)));
      if (matches.length > 1) throw new Error('Ambiguous ICA activation credential type.');
      return matches[0];
    };
    const organization = select(ORGANIZATION_ACTIVATION_VC_TYPES);
    const representative = select(REPRESENTATIVE_ACTIVATION_VC_TYPES);
    const controller = select(SERVICE_CONTROLLER_ACTIVATION_VC_TYPES);
    if (!organization || !representative || (!controller && !this.options.allowLegacyRepresentativeBootstrap)) throw new Error('ICA activation credential set is incomplete.');
    const errors = validateActivationRepresentativePolicy({ organizationCredential: organization, representativeCredential: representative, controllerCredential: controller });
    if (errors.length) throw new Error(errors[0].message);
    const binding = controller ? extractRepresentativeCredentialBinding({ credentialSubject: controller.credentialSubject?.owner }) : extractRepresentativeCredentialBinding(representative);
    if (!binding || binding !== toJwkThumbprintSha256Urn(actorKey as any)) throw new Error('ICA-authorized controller key does not match the presentation signer.');
    const acr = 'urn:antifraud:acr:openid4vp:employee';
    if (!request.acrValues.includes(acr)) throw new Error('Controller assurance was not requested.');
    return { activationEvidenceSource: 'ica', acr, amr: ['vp', 'ica'], vpHash: createHash('sha256').update(request.vpToken).digest('hex'), ledgerVerified: false,
      trustChecks: { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false } };
  }
}
