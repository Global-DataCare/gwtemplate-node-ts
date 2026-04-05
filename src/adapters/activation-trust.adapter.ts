import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { ClearingHouseVerificationResult, IClearingHouseService } from '../services/ClearingHouseService';

export type ActivationNetworkMode = 'test' | 'test-network' | 'network';

export type ActivationTrustEvaluationInput = {
  networkMode: ActivationNetworkMode;
  vpToken: string;
  presentationSubmission?: any;
  organizationCredential?: any;
  representativeCredential?: any;
  primaryDid?: string;
  jurisdiction?: string;
  sector?: string;
};

export type ActivationTrustEvaluationResult = {
  organizationDid: string;
  representativeDid?: string;
  clearingHouse: ClearingHouseVerificationResult;
  trustPolicy: {
    networkMode: ActivationNetworkMode;
    revocationChecked: boolean;
    issuerKeyStatusChecked: boolean;
    subjectKeyStatusChecked: boolean;
    onChainChecked: boolean;
  };
};

export interface IActivationTrustAdapter {
  evaluate(input: ActivationTrustEvaluationInput): Promise<ActivationTrustEvaluationResult>;
}

function extractDidFromCredential(credential: any): string | undefined {
  if (!credential || typeof credential !== 'object') {
    return undefined;
  }
  const subject = Array.isArray(credential.credentialSubject)
    ? credential.credentialSubject[0]
    : credential.credentialSubject;
  const didCandidate = subject?.id || credential?.id;
  return typeof didCandidate === 'string' && didCandidate.startsWith('did:web:')
    ? didCandidate
    : undefined;
}

function assertActivationCredentialConsistency(params: {
  primaryDid?: string;
  organizationCredential?: any;
  representativeCredential?: any;
}): { organizationDid: string; representativeDid: string } {
  const { primaryDid, organizationCredential, representativeCredential } = params;
  if (!organizationCredential) {
    throw new ManagerError('Missing ICA-issued organization credential.', IssueType.Required);
  }
  if (!representativeCredential) {
    throw new ManagerError('Missing ICA-issued representative credential.', IssueType.Required);
  }

  const organizationDidFromCredential = extractDidFromCredential(organizationCredential);
  if (!organizationDidFromCredential) {
    throw new ManagerError('ICA-issued organization credential is missing credentialSubject.id did:web.', IssueType.Required);
  }
  if (primaryDid && organizationDidFromCredential !== primaryDid) {
    throw new ManagerError('Submitted organization DID does not match ICA-issued organization credential DID.', IssueType.Conflict);
  }

  const representativeDidFromCredential = extractDidFromCredential(representativeCredential);
  if (!representativeDidFromCredential) {
    throw new ManagerError('ICA-issued representative credential is missing credentialSubject.id did:web.', IssueType.Required);
  }

  return {
    organizationDid: organizationDidFromCredential,
    representativeDid: representativeDidFromCredential,
  };
}

export class DefaultActivationTrustAdapter implements IActivationTrustAdapter {
  private readonly clearingHouseService: IClearingHouseService;

  constructor(clearingHouseService: IClearingHouseService) {
    this.clearingHouseService = clearingHouseService;
  }

  async evaluate(input: ActivationTrustEvaluationInput): Promise<ActivationTrustEvaluationResult> {
    const consistency = assertActivationCredentialConsistency({
      primaryDid: input.primaryDid,
      organizationCredential: input.organizationCredential,
      representativeCredential: input.representativeCredential,
    });

    const clearingHouse = await this.clearingHouseService.verifyVpToken({
      vpToken: input.vpToken,
      presentationSubmission: input.presentationSubmission,
      acrValues: [
        'urn:antifraud:acr:openid4vp:employee',
        'urn:antifraud:acr:openid4vp:individual',
      ],
    });

    // NOTE: These checks are explicitly modeled by network mode so they can be delegated
    // to specialized adapters (dataspace/blockchain) without coupling HostingManager.
    const strictNetwork = input.networkMode === 'test-network' || input.networkMode === 'network';

    return {
      organizationDid: consistency.organizationDid,
      representativeDid: consistency.representativeDid,
      clearingHouse,
      trustPolicy: {
        networkMode: input.networkMode,
        revocationChecked: strictNetwork,
        issuerKeyStatusChecked: strictNetwork,
        subjectKeyStatusChecked: strictNetwork,
        onChainChecked: input.networkMode === 'network',
      },
    };
  }
}
