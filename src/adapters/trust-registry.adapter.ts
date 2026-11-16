import { isLocalDemoSecurityMode } from '../security/runtime-security-policy';
export type ActivationNetworkMode = 'test' | 'local-network' | 'test-network' | 'network';

export type TrustRegistryVerificationInput = {
  networkMode: ActivationNetworkMode;
  jurisdiction?: string;
  sector?: string;
  organizationDid: string;
  representativeDid?: string;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  now?: Date;
  verificationEvidence?: TrustRegistryVerificationResult;
};

export type TrustRegistryVerificationResult = {
  revocationChecked: boolean;
  issuerKeyStatusChecked: boolean;
  subjectKeyStatusChecked: boolean;
  onChainChecked: boolean;
};

export interface ITrustRegistryAdapter {
  verifyActivationTrust(input: TrustRegistryVerificationInput): Promise<TrustRegistryVerificationResult>;
}

/** Accepts only checks carried by an authenticated verifier result; network labels are never evidence. */
export class DefaultTrustRegistryAdapter implements ITrustRegistryAdapter {
  async verifyActivationTrust(input: TrustRegistryVerificationInput): Promise<TrustRegistryVerificationResult> {
    if (isLocalDemoSecurityMode() && input.networkMode === 'test') return { revocationChecked: false, issuerKeyStatusChecked: false, subjectKeyStatusChecked: false, onChainChecked: false };
    const evidence = input.verificationEvidence;
    if (!evidence || evidence.revocationChecked !== true || evidence.issuerKeyStatusChecked !== true
      || evidence.subjectKeyStatusChecked !== true || (input.networkMode !== 'test' && evidence.onChainChecked !== true)) {
      throw new Error('Trust registry verification requires explicit, verified current ledger evidence.');
    }
    return { ...evidence };
  }
}
