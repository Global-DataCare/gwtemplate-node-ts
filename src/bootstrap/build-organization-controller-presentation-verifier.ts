import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ITenantsManager } from '../managers/ITenantsManager';
import type { OrganizationControllerPresentationRequest } from '../managers/TenantPresentationVerificationManager';
import type { IcaActivationVerifier } from '../services/IcaActivationVerifier';
import { tryGetJwkThumbprint } from '../utils/ledger-organization-registration-helpers';
import { getEnvSectionId } from '../utils/section-env';
import { parseTenantUrn } from '../utils/urn';

/** Confirms ICA evidence and the hosted organization's current controller registration. */
export function buildOrganizationControllerPresentationVerifier(options: {
  network: string;
  tenantManager: Pick<ITenantsManager, 'getDidDocument' | 'getTenantIdentifierUrn' | 'getCollectionName' | 'isTenantOperational'>;
  vaultRepository: Pick<IVaultRepository, 'get'>;
  kmsService: Pick<IKmsService, 'unprotectConfidentialData'>;
  icaVerifier: Pick<IcaActivationVerifier, 'verifyServicePresentation'>;
}) {
  const { tenantManager, vaultRepository, kmsService } = options;
  return async (request: OrganizationControllerPresentationRequest) => {
    const tenant = await tenantManager.getDidDocument(request.vaultId);
    const scope = parseTenantUrn(await tenantManager.getTenantIdentifierUrn(request.vaultId) || '');
    if (tenant?.id !== request.tenantDid || !scope || scope.network !== options.network
      || scope.jurisdiction.toUpperCase() !== request.jurisdiction.toUpperCase() || scope.sector !== request.sector) {
      throw new Error('Verification route does not match the registered organization.');
    }
    const evidence = await options.icaVerifier.verifyServicePresentation(
      request.vpToken, request.audience, request.tenantId, { type: scope.idType, value: scope.idValue },
    );
    const thumbprint = tryGetJwkThumbprint(evidence.actorKey as PublicJwk);
    const collection = await tenantManager.getCollectionName(request.vaultId);
    if (!thumbprint || !collection) throw new Error('Controller registration is unavailable.');
    const currentTenant = await tenantManager.getDidDocument(request.vaultId);
    if (currentTenant?.id !== request.tenantDid || !await tenantManager.isTenantOperational(request.vaultId)) {
      throw new Error('Organization is no longer active.');
    }
    const registered = currentTenant.controller;
    const controllers = Array.isArray(registered) ? registered : registered ? [registered] : [];
    for (const controller of controllers) {
      const record = await vaultRepository.get<ConfidentialStorageDoc>(collection, controller, getEnvSectionId('employees'));
      if (!record || record.status !== EntityLifecycleStatus.Active) continue;
      const employee = await kmsService.unprotectConfidentialData<EntityConfig>(record, request.vaultId);
      if (employee.status === EntityLifecycleStatus.Active && employee.didDocument?.id === controller
        && employee.didDocument.verificationMethod?.some(method => tryGetJwkThumbprint(method.publicKeyJwk as PublicJwk | undefined) === thumbprint)) {
        return { issuer: evidence.issuer, id: evidence.id, expiresAt: evidence.expiresAt };
      }
    }
    throw new Error('The signing key is not registered to an active organization controller.');
  };
}
