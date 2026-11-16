// Flow contract: the canonical SDK signs a wallet VP containing a professional identity projection; only a fresh authenticated DCR client and current authoritative employment can establish that identity. A projection is never an independently issuer-signed VC.
import { LedgerPresentationVerifier } from '../../../services/LedgerPresentationVerifier';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { buildProfessionalIdentityVpPayload, summarizeProfessionalIdentityCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_PROFESSIONAL_DID, EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, EXAMPLE_PROVIDER_ORGANIZATION_DID } from 'gdc-common-utils-ts/examples/shared';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';

describe('registered professional wallet presentation', () => {
  async function fixture() {
    const publicKey = deriveDeterministicEcJwkPair({ seed: EXAMPLE_DEVICE_CLIENT_ID, purpose: 'registered-professional-vp' }).publicJwk;
    const vp = await buildDeterministicSignedJwt({ seed: EXAMPLE_DEVICE_CLIENT_ID, purpose: 'registered-professional-vp', payload: {
      iss: publicKey.kid, sub: EXAMPLE_PROFESSIONAL_DID,
      ...buildProfessionalIdentityVpPayload({ clientId: EXAMPLE_DEVICE_CLIENT_ID, actorDid: EXAMPLE_PROFESSIONAL_DID, role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN }),
    } });
    let active = true;
    const verifier = new LedgerPresentationVerifier({ network: 'test', ledgerKind: 'memory', ledger: new CredentialLedgerAdapterMem(),
      resolveHolderKeys: async holder => { if (holder !== EXAMPLE_DEVICE_CLIENT_ID) throw new Error('Unknown client.'); return { keys: [vp.publicJwk] }; },
      resolveIssuerKeys: async () => { throw new Error('Not an issuer credential.'); }, assertActiveKey: async () => {}, authorize: async () => {},
      ...{ verifyRegisteredIdentity: async (credential: unknown) => {
        const identity = summarizeProfessionalIdentityCredential(credential);
        if (!active || identity?.actorDid !== EXAMPLE_PROFESSIONAL_DID || identity.role !== EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN) throw new Error('Inactive employment.');
        return { actorDid: identity.actorDid, acr: 'urn:antifraud:acr:openid4vp:employee' };
      } },
    });
    const request = { tenantDid: EXAMPLE_PROVIDER_ORGANIZATION_DID, vpToken: vp.compactToken,
      authenticatedClientId: EXAMPLE_DEVICE_CLIENT_ID, tokenSubject: EXAMPLE_PROFESSIONAL_DID, acrValues: ['urn:antifraud:acr:openid4vp:employee'] };
    return { verifier, request, revoke: () => { active = false; } };
  }
  it('verifies the canonical signed SDK projection against current registered identity', async () => {
    const f = await fixture(); expect(await f.verifier.verifyVpToken(f.request)).toMatchObject({ acr: f.request.acrValues[0], trustChecks: { onChainChecked: false, issuerKeyStatusChecked: false } });
  });
  it('rejects the same wallet presentation after employment is disabled', async () => {
    const f = await fixture(); await f.verifier.verifyVpToken(f.request); f.revoke(); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/employment/i);
  });
  it('rejects a reusable projection without fresh registered-client authentication', async () => {
    const f = await fixture(); await expect(f.verifier.verifyVpToken({ ...f.request, authenticatedClientId: undefined })).rejects.toThrow();
  });
});
