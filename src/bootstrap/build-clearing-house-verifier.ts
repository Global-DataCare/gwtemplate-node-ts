import { resolveProfessionalHomeVault } from './resolve-professional-home-vault';
import { verifyRegisteredProfessionalIdentity } from './verify-registered-presentation-identity';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { ManageAssetSubjectKeyBinding } from '../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { ManageAssetProfessionalAssignment } from '../blockchain/fabric/v3/manageAssetProfessionalAssignment';
import { ManageAsset } from '../blockchain/fabric/v3/manageAsset';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { JSONWebKeySet, JWK } from 'jose';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { LedgerPresentationVerifier } from '../services/LedgerPresentationVerifier';
import type { ClearingHouseVerificationRequest } from '../services/ClearingHouseService';
import { getTenantVaultIdFromIss } from '../utils/tenant';
import { getEnvSectionId } from '../utils/section-env';
import { tryGetJwkThumbprint } from '../utils/ledger-organization-registration-helpers';
import { ManageAssetCryptographicKey } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import { CryptographicKeyIdentityChaincode, SubjectKeyBindingIdentityChaincode, resolveOrganizationIdentityChannel } from '../utils/ledger';
import type { ITenantsManager } from '../managers/ITenantsManager';

/** Native verifier reads registered holder keys and the authoritative ledger. */
export function buildLocalClearingHouseVerifier(options: {
  network: string;
  ledgerKind: 'memory' | 'fabric';
  tenants: ITenantsManager;
  ledger: ICredentialLedgerAdapter;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  cryptography: ICryptography;
  authorize: (request: ClearingHouseVerificationRequest) => Promise<void>;
}): LedgerPresentationVerifier {
  const trustedIssuer = (issuer: string): { jwks: JSONWebKeySet; channelName?: string; status?: string } => {
    const entries = JSON.parse(process.env.CREDENTIAL_TRUSTED_ISSUERS_JSON || '{}');
    if (!Object.prototype.hasOwnProperty.call(entries, issuer) || !Array.isArray(entries[issuer]?.jwks?.keys)) throw new Error('Credential issuer is not trusted by this host.');
    return entries[issuer];
  };
  const holderVault = async (request: ClearingHouseVerificationRequest): Promise<string> => {
    const recipient = request.tenantVaultId || getTenantVaultIdFromIss(String(request.tenantDid || ''));
    if ((await options.tenants.getDidDocument(recipient))?.id !== request.tenantDid || !await options.tenants.isTenantOperational(recipient)) throw new Error('Verifier tenant does not match an active registration.');
    const home = request.holderVaultId || (request.tokenSubject ? await resolveProfessionalHomeVault(options.tenants, request.tokenSubject, recipient) : recipient);
    if (!await options.tenants.isTenantOperational(home)) throw new Error('Professional home tenant is inactive.');
    return home;
  };
  return new LedgerPresentationVerifier({
    network: options.network,
    ledgerKind: options.ledgerKind,
    ledger: options.ledger,
    cryptography: options.cryptography,
    channelName: options.ledgerKind === 'fabric' ? resolveOrganizationIdentityChannel(process.env.HOST_JURISDICTION) : undefined,
    resolveHolderKeys: async (holder, tenantDid, request) => {
      const vaultId = await holderVault(request);
      const document = await options.vaultRepository.get<any>(vaultId, holder, getEnvSectionId('device-profiles'));
      if (!document || document.status !== 'active') throw new Error('Presentation holder has no active registered device.');
      const profile = await options.kmsService.unprotectConfidentialData<any>(document, vaultId);
      if (profile?.clientId !== holder || !Array.isArray(profile?.jwks?.keys)) throw new Error('Presentation holder does not match its registered device.');
      return profile.jwks;
    },
    resolveIssuerKeys: async issuer => trustedIssuer(issuer).jwks,
    assertActiveKey: async (owner: string, key: JWK, request) => {
      if (options.ledgerKind === 'memory') {
        if (options.network !== 'test') throw new Error('Memory key verification is restricted to local test.');
        const thumbprint = tryGetJwkThumbprint(key as any);
        if (!thumbprint) throw new Error('Signing key has no canonical thumbprint.');
        const entries = JSON.parse(process.env.CREDENTIAL_TRUSTED_ISSUERS_JSON || '{}');
        if (Object.prototype.hasOwnProperty.call(entries, owner)) {
          const issuer = trustedIssuer(owner);
          if (issuer.status !== 'active' || !issuer.jwks.keys.some(candidate => tryGetJwkThumbprint(candidate as any) === thumbprint)) throw new Error('Issuer signing key is not currently trusted and active.');
          return;
        }
        const vaultId = await holderVault(request);
        const document = await options.vaultRepository.get<any>(vaultId, owner, getEnvSectionId('device-profiles'));
        if (document?.status !== 'active') throw new Error('Device signing key registration is inactive.');
        const profile = await options.kmsService.unprotectConfidentialData<any>(document, vaultId);
        if (profile?.clientId !== owner || !profile.jwks?.keys?.some((candidate: JWK) => tryGetJwkThumbprint(candidate as any) === thumbprint)) throw new Error('Signing key is not present in the current device registration.');
        return;
      }
      const mspId = String(process.env.LEDGER_MSP_ID || process.env.LEDGER_FABRIC_MSP_ID || '').trim();
      if (!mspId) throw new Error('Signing-key ledger MSP is not configured.');
      const thumbprint = tryGetJwkThumbprint(key as any);
      if (!thumbprint) throw new Error('Signing key has no canonical ledger thumbprint.');
      const manager = new ManageAssetCryptographicKey({ chaincodeName: CryptographicKeyIdentityChaincode,
        channelName: resolveOrganizationIdentityChannel(process.env.HOST_JURISDICTION) });
      const record = await manager.read(mspId, thumbprint) as Record<string, any>;
      if (record?.status !== 'active' || record.thumbprint !== thumbprint || (record.expiresAt != null && record.expiresAt <= Date.now() / 1000)) throw new Error('Signing key is not currently active on Fabric.');
    },
    verifyRegisteredIdentity: async (credential, holder, key, request) => {
      const vaultId = await holderVault(request);
      const employeeCollection = await options.tenants.getCollectionName(vaultId);
      if (!employeeCollection) throw new Error('Authoritative employee collection is unavailable.');
      const identity = await verifyRegisteredProfessionalIdentity({ credential, holder, vaultId, employeeCollection,
        kmsService: options.kmsService, vaultRepository: options.vaultRepository });
      if (options.ledgerKind === 'fabric') {
        const mspId = String(process.env.LEDGER_MSP_ID || process.env.LEDGER_FABRIC_MSP_ID || '').trim();
        const keyId = tryGetJwkThumbprint(key as any);
        if (!mspId || !keyId || !identity.employeeUrn || !identity.stableActorIdentifier) throw new Error('Professional Fabric identity binding is incomplete.');
        const channelName = resolveOrganizationIdentityChannel(process.env.HOST_JURISDICTION);
        const binding = await new ManageAssetSubjectKeyBinding({ chaincodeName: SubjectKeyBindingIdentityChaincode, channelName })
          .read(mspId, `employee_${identity.employeeUrn}__${keyId}`) as Record<string, any>;
        if (binding?.status !== 'active' || binding.keyId !== keyId || binding.subjectId !== identity.employeeUrn
          || normalizeCodeSystemAndValue(binding.licensedRole) !== normalizeCodeSystemAndValue(identity.role)
          || !binding.roleLicenseId || !binding.professionalAssignmentLink) throw new Error('Professional key binding is not currently active on Fabric.');
        const licence = await new ManageAsset('roleLicense', { chaincodeName: 'rolelicense-sc', channelName }).read(mspId, binding.roleLicenseId) as Record<string, any>;
        if (licence?.status !== 'active' || licence.stableContactIdentifier !== identity.stableActorIdentifier
          || normalizeCodeSystemAndValue(licence.licensedRole) !== normalizeCodeSystemAndValue(identity.role)) throw new Error('Professional role licence is not currently active on Fabric.');
        const assignment = await new ManageAssetProfessionalAssignment({ channelName }).read(mspId, binding.professionalAssignmentLink) as Record<string, any>;
        if (assignment?.status !== 'active' || assignment.assignmentLink !== binding.professionalAssignmentLink
          || !binding.employeeLink || assignment.employeeLink !== binding.employeeLink
          || !binding.organizationLink || assignment.organizationLink !== binding.organizationLink
          || normalizeCodeSystemAndValue(assignment.role) !== normalizeCodeSystemAndValue(identity.role)) throw new Error('Professional assignment is not currently active on Fabric.');
      }
      return identity;
    },
    authorize: options.authorize,
  });
}
