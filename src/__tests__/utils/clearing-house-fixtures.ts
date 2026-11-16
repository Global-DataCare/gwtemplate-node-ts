// Flow contract: explicit unit-only verification fixtures isolate hosting policy; runtime cryptography and ledger proof live in the real Clearing House journey tests.
import { createHash } from 'node:crypto';
import type { IClearingHouseService } from '../../services/ClearingHouseService';
import { assertActivationCredentialConsistency, type IActivationTrustAdapter } from '../../adapters/activation-trust.adapter';

export function createClearingHouseUnitFixture(): IClearingHouseService {
  return { verifyVpToken: jest.fn(async request => ({ acr: request.acrValues[0], amr: ['openid4vp', 'vc'],
    vpHash: createHash('sha256').update(request.vpToken).digest('hex'), ledgerVerified: true,
    trustChecks: { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: true } })) };
}

/** Policy-only fixture: deliberately excludes VP cryptography, exercised by the ICA HTTP verifier suite. */
export function createActivationTrustUnitFixture(): IActivationTrustAdapter {
  return { evaluate: async input => ({ ...assertActivationCredentialConsistency(input),
    clearingHouse: await createClearingHouseUnitFixture().verifyVpToken({ vpToken: input.vpToken, acrValues: ['urn:antifraud:acr:openid4vp:employee'] }),
    trustPolicy: { networkMode: input.networkMode, revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: true } }) };
}
