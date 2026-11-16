// Flow contract: verify real VP/VC signatures against authoritative keys and read current credential/key state on every call; revocation, missing state and denied consent must reject the same previously accepted presentation.
import canonicalize from 'canonicalize';
import { FlattenedSign, importJWK } from 'jose';
import { LedgerPresentationVerifier } from '../../../services/LedgerPresentationVerifier';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';
import { buildProfessionalEmployeeCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { EXAMPLE_CONTROLLER_DID, EXAMPLE_PROVIDER_ORGANIZATION_DID, EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN } from 'gdc-common-utils-ts/examples/shared';

describe('ledger-backed presentation verification', () => {
  const now = Math.floor(Date.now() / 1000);
  async function fixture(genericCredential = false, wrongHolder = false, options: { detached?: boolean; expiredLegacy?: boolean; invalidDetached?: boolean } = {}) {
    const credentialId = 'urn:uuid:fedcba98-7654-4321-aaaa-0123456789ab';
    const holderKey = deriveDeterministicEcJwkPair({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'ledger-verifier-holder' }).publicJwk;
    const otherKey = deriveDeterministicEcJwkPair({ seed: EXAMPLE_PROVIDER_ORGANIZATION_DID, purpose: 'ledger-verifier-other-holder' }).publicJwk;
    const identity = genericCredential ? { type: ['VerifiableCredential'], credentialSubject: { id: EXAMPLE_CONTROLLER_DID } }
      : buildProfessionalEmployeeCredential({ actorDid: EXAMPLE_CONTROLLER_DID, role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, credentialMaterial: toJwkThumbprintSha256Urn((wrongHolder ? otherKey : holderKey) as any) });
    const vc = await buildDeterministicSignedJwt({ seed: EXAMPLE_PROVIDER_ORGANIZATION_DID, purpose: 'ledger-verifier-credential', payload: { ...identity, iss: EXAMPLE_PROVIDER_ORGANIZATION_DID, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID, iat: now, exp: now + 120, jti: credentialId, id: credentialId, ...(options.expiredLegacy ? { expirationDate: new Date((now - 60) * 1000).toISOString() } : {}) } });
    let credentialInput: unknown = vc.compactToken;
    if (options.detached) {
      const credential = { ...identity, id: credentialId, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        validFrom: new Date((now - 60) * 1000).toISOString(), validUntil: new Date((now + 120) * 1000).toISOString() };
      const verificationMethod = `${EXAMPLE_PROVIDER_ORGANIZATION_DID}#${vc.publicJwk.kid}`;
      const signed = await new FlattenedSign(Buffer.from(canonicalize(credential)!))
        .setProtectedHeader({ alg: 'ES384', kid: verificationMethod, b64: false, crit: ['b64'] })
        .sign(await importJWK(vc.privateJwk, 'ES384'));
      let signature = signed.signature;
      if (options.invalidDetached) { const bytes = Buffer.from(signature, 'base64url'); bytes[0] ^= 1; signature = bytes.toString('base64url'); }
      credentialInput = { ...credential, proof: { type: 'JsonWebSignature2020', verificationMethod, jws: `${signed.protected}..${signature}` } };
    }
    const vp = await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'ledger-verifier-holder', payload: { iss: EXAMPLE_CONTROLLER_DID, aud: EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 120, jti: 'ledger-presentation', acr: 'urn:antifraud:acr:openid4vp:employee', vp: { type: ['VerifiablePresentation'], verifiableCredential: [credentialInput] } } });
    const ledger = new CredentialLedgerAdapterMem();
    ledger.seedStatus('test', { id: credentialId, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID, status: 'active', updatedAt: now });
    const keys = new Map([[vc.publicJwk.kid!, 'active'], [vp.publicJwk.kid!, 'active']]);
    let permitted = true;
    const verifier = new LedgerPresentationVerifier({ network: 'test', ledgerKind: 'memory', ledger, now: () => now,
      resolveHolderKeys: async () => ({ keys: [vp.publicJwk] }), resolveIssuerKeys: async () => ({ keys: [vc.publicJwk] }),
      assertActiveKey: async (_owner: string, key: any) => { if (keys.get(key.kid) !== 'active') throw new Error('Signing key is not active.'); },
      authorize: async () => { if (!permitted) throw new Error('Consent denied.'); },
    });
    const request = { tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: vp.compactToken, acrValues: ['urn:antifraud:acr:openid4vp:employee'], tokenSubject: EXAMPLE_CONTROLLER_DID, tokenScope: 'scoped-access' };
    return { verifier, request, ledger, credentialId, keys, vp, deny: () => { permitted = false; } };
  }
  it('accepts a real signed presentation with current positive evidence', async () => { const f = await fixture(); expect(await f.verifier.verifyVpToken(f.request)).toMatchObject({ ledgerVerified: true }); });
  it('rejects the previously accepted credential after ledger revocation', async () => {
    const f = await fixture(); await f.verifier.verifyVpToken(f.request); f.ledger.seedStatus('test', { id: f.credentialId, status: 'revoked', updatedAt: now });
    await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/active|revok/i);
  });
  it('rejects a current holder signing-key revocation', async () => { const f = await fixture(); f.keys.set(f.vp.publicJwk.kid!, 'revoked'); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/key/i); });
  it('rejects current permission denial', async () => { const f = await fixture(); f.deny(); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/consent/i); });
  it('rejects a copied professional credential bound to another signing key', async () => { const f = await fixture(false, true); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/bind|holder|key/i); });
  it('verifies an ICA-style detached ES384 proof with its full verification-method identifier', async () => { const f = await fixture(false, false, { detached: true }); expect(await f.verifier.verifyVpToken(f.request)).toMatchObject({ ledgerVerified: true }); });
  it('rejects a forged detached issuer signature', async () => { const f = await fixture(false, false, { detached: true, invalidDetached: true }); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/signature/i); });
  it('rejects a legacy VC expirationDate even when the enclosing JWT is still current', async () => { const f = await fixture(false, false, { expiredLegacy: true }); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/expir/i); });
  it('does not promote an unrelated credential into employee assurance chosen by its holder', async () => { const f = await fixture(true); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/assurance|professional/i); });
});
