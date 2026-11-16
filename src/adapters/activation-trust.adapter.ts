import { isLocalDemoSecurityMode } from '../security/runtime-security-policy';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { getVpCredentials } from 'gdc-common-utils-ts/utils/vp-token';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { isSignatureJwk } from '../managers/hosting/registration-keys';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  extractDidWebFromCredential,
  extractRepresentativeSubjectId,
  validateActivationRepresentativePolicy,
} from 'gdc-common-utils-ts/utils/activation-policy';
import { ClearingHouseVerificationResult, IClearingHouseService } from '../services/ClearingHouseService';
import { compactVerify, decodeProtectedHeader, importJWK, JWK } from 'jose';
import {
  DefaultTrustRegistryAdapter,
  ITrustRegistryAdapter,
} from './trust-registry.adapter';

export type ActivationNetworkMode = 'test' | 'local-network' | 'test-network' | 'network';

export type ActivationTrustEvaluationInput = {
  networkMode: ActivationNetworkMode;
  vpToken: string;
  presentationSubmission?: any;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  primaryDid?: string;
  /** Receiving host identity supplied by the hosting manager, never by the request body. */
  verifierTenantDid?: string;
  controllerBinding?: { publicKeyJwk?: PublicJwk; jwks?: { keys: PublicJwk[] } };
  jurisdiction?: string;
  sector?: string;
  /** Deployment-wide historical first-controller compatibility only. */
  allowLegacyRepresentativeBootstrap?: boolean;
};

export type ActivationTrustEvaluationResult = {
  organizationDid: string;
  representativeDid?: string;
  clearingHouse: ClearingHouseVerificationResult;
  /** Business signing key whose ICA authorization was checked by the verifier. */
  controllerSigningKey?: PublicJwk;
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



async function verifyVpTokenProof(vpToken: string): Promise<void> {
  const compact = String(vpToken || '').trim();
  const parts = compact.split('.');
  if (parts.length !== 3) {
    throw new ManagerError('vp_token must be a compact JWT (JWS).', IssueType.Security);
  }
  const header = decodeProtectedHeader(compact);
  const alg = String(header.alg || '').trim();
  if (!alg || alg.toLowerCase() === 'none') {
    throw new ManagerError('vp_token must be signed with a supported algorithm.', IssueType.Security);
  }
  const allowed = new Set(['ES256K', 'ES384', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87']);
  if (!allowed.has(alg)) {
    throw new ManagerError(`Unsupported vp_token algorithm '${alg}'.`, IssueType.Security);
  }

  // For classical JOSE algorithms, verify immediately when JWK is embedded.
  if ((alg === 'ES256K' || alg === 'ES384') && header.jwk && typeof header.jwk === 'object') {
    const keyLike = await importJWK(header.jwk as JWK, alg);
    await compactVerify(compact, keyLike);
  }
}

export function assertActivationCredentialConsistency(params: {
  primaryDid?: string;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  allowLegacyRepresentativeBootstrap?: boolean;
}): { organizationDid: string; representativeDid?: string } {
  /**
   * Representative proof is intentionally split into two dimensions:
   * - `credentialSubject.sameAs` for public identity continuity
   * - `credentialSubject.hasCredential.material` for controller signing-key continuity
   *
   * GW activation enforces the key-binding dimension through shared activation
   * policy validation. The public-identity dimension remains complementary and
   * is expected to be present in production-grade ICA-issued credentials, but
   * demo/local flows may still need higher-level fallbacks when signed PDF
   * evidence did not carry `person.email`.
   */
  const {
    primaryDid,
    organizationCredential,
    representativeCredential,
    controllerCredential,
    allowLegacyRepresentativeBootstrap,
  } = params;
  if (!organizationCredential) {
    throw new ManagerError('Missing ICA-issued organization credential.', IssueType.Required);
  }

  const organizationDidFromCredential = extractDidWebFromCredential(organizationCredential);
  if (!organizationDidFromCredential) {
    throw new ManagerError('ICA-issued organization credential is missing credentialSubject.id did:web.', IssueType.Required);
  }
  if (primaryDid && organizationDidFromCredential !== primaryDid) {
    throw new ManagerError('Submitted organization DID does not match ICA-issued organization credential DID.', IssueType.Conflict);
  }

  const representativeSubjectId = representativeCredential
    ? extractRepresentativeSubjectId(representativeCredential)
    : undefined;
  const policyErrors = validateActivationRepresentativePolicy({
    organizationCredential,
    representativeCredential,
    controllerCredential,
  }).filter(error => !allowLegacyRepresentativeBootstrap || ![
    'MISSING_REPRESENTATIVE_ROLE_RESPRSN',
    'MISSING_REPRESENTATIVE_CREDENTIAL_BINDING',
  ].includes(error.code));
  if (policyErrors.length > 0) {
    const first = policyErrors[0];
    const issue = first.code === 'REPRESENTATIVE_TAXID_MISMATCH' || first.code === 'CONTROLLER_TAXID_MISMATCH'
      ? IssueType.Conflict
      : IssueType.Required;
    throw new ManagerError(first.message, issue);
  }

  return {
    organizationDid: organizationDidFromCredential,
    representativeDid: representativeSubjectId?.startsWith('did:web:')
      ? representativeSubjectId
      : undefined,
  };
}

export class DefaultActivationTrustAdapter implements IActivationTrustAdapter {
  private readonly clearingHouseService: IClearingHouseService;
  private readonly trustRegistryAdapter: ITrustRegistryAdapter;

  constructor(
    clearingHouseService: IClearingHouseService,
    trustRegistryAdapter: ITrustRegistryAdapter = new DefaultTrustRegistryAdapter(),
  ) {
    this.clearingHouseService = clearingHouseService;
    this.trustRegistryAdapter = trustRegistryAdapter;
  }

  async evaluate(input: ActivationTrustEvaluationInput): Promise<ActivationTrustEvaluationResult> {
    if (!isLocalDemoSecurityMode()) {
      if (!input.verifierTenantDid) throw new ManagerError('Activation requires the receiving host verification context.', IssueType.Security);
      await verifyVpTokenProof(input.vpToken);
      const presented = getVpCredentials(input.vpToken);
      for (const credential of [input.organizationCredential, input.representativeCredential, input.controllerCredential]) {
        if (credential && !presented.some(candidate => canonicalize(candidate) === canonicalize(credential))) {
          throw new ManagerError('Submitted activation credential does not match the signed presentation.', IssueType.Security);
        }
      }
    }

    const consistency = assertActivationCredentialConsistency({
      primaryDid: input.primaryDid,
      organizationCredential: input.organizationCredential,
      representativeCredential: input.representativeCredential,
      controllerCredential: input.controllerCredential,
      allowLegacyRepresentativeBootstrap: input.allowLegacyRepresentativeBootstrap,
    });

    const clearingHouse = await this.clearingHouseService.verifyVpToken({
      tenantDid: input.verifierTenantDid,
      tenantVaultId: 'host',
      vpToken: input.vpToken,
      presentationSubmission: input.presentationSubmission,
      acrValues: [
        'urn:antifraud:acr:openid4vp:employee',
        'urn:antifraud:acr:openid4vp:individual',
      ],
    });

    if (clearingHouse.activationEvidenceSource === 'ica'
      && (clearingHouse.ledgerVerified !== false || !clearingHouse.amr?.includes('ica')
        || clearingHouse.vpHash !== createHash('sha256').update(input.vpToken).digest('hex'))) {
      throw new ManagerError('Native ICA verification evidence does not match this activation presentation.', IssueType.Security);
    }

    let controllerSigningKey: PublicJwk | undefined;
    if (!isLocalDemoSecurityMode()) {
      controllerSigningKey = decodeProtectedHeader(input.vpToken).jwk as PublicJwk | undefined;
      const suppliedKeys = [input.controllerBinding?.publicKeyJwk, ...(input.controllerBinding?.jwks?.keys || []).filter(isSignatureJwk)].filter(Boolean) as PublicJwk[];
      if (suppliedKeys.length && (!controllerSigningKey || suppliedKeys.some(key => toJwkThumbprintSha256Urn(key as any) !== toJwkThumbprintSha256Urn(controllerSigningKey as any)))) {
        throw new ManagerError('Controller registration signing key does not match the ICA-authorized presentation signer.', IssueType.Security);
      }
    }

    const trustPolicy = await this.trustRegistryAdapter.verifyActivationTrust({
      networkMode: input.networkMode,
      verificationEvidence: clearingHouse.trustChecks,
      activationEvidenceSource: clearingHouse.activationEvidenceSource,
      jurisdiction: input.jurisdiction,
      sector: input.sector,
      organizationDid: consistency.organizationDid,
      representativeDid: consistency.representativeDid,
      organizationCredential: input.organizationCredential,
      representativeCredential: input.representativeCredential,
      controllerCredential: input.controllerCredential,
    });

    return {
      organizationDid: consistency.organizationDid,
      representativeDid: consistency.representativeDid,
      clearingHouse,
      ...(controllerSigningKey ? { controllerSigningKey } : {}),
      trustPolicy: {
        networkMode: input.networkMode,
        ...trustPolicy,
      },
    };
  }
}
