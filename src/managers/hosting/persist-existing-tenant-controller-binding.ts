import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { populateDidDocumentFromJwks } from '../../utils/did-backend';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';
import type { registerControllerKeysOnLedger as registerControllerKeysOnLedgerFunction } from '../../utils/ledger-device-registration';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import { mergeActivationJwks } from './registration-keys';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import type { ActivationParticipantMaterialLike } from './controller-entity-config';

type PersistExistingTenantControllerBindingDeps = Readonly<{
  claims: ClaimsRecord;
  controller?: ActivationParticipantMaterialLike;
  verifiedSignerKid?: string;
  transactionId?: string;
  hostCollectionName?: string;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantsCacheManager: IHostingTenantRegistry;
  registerControllerKeysOnLedger?: typeof registerControllerKeysOnLedgerFunction;
}>;

const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

/**
 * Promotes an ICA-approved controller keyring onto an already provisioned
 * tenant. The signed `_issue` request must prove possession of one submitted
 * key, so an unrelated caller cannot replace the controller projection.
 */
export async function persistExistingTenantControllerBinding(
  deps: PersistExistingTenantControllerBindingDeps,
): Promise<void> {
  // Presence of an explicit JWKS is the migration signal. Historical `_issue`
  // payloads can carry a controller DID plus one `publicKeyJwk`; they must keep
  // working without being mistaken for a controller-keyring replacement.
  if (!deps.controller?.jwks?.keys?.length) return;
  const controllerDid = String(deps.controller?.did || '').trim();
  const controllerSameAs = String(deps.controller?.sameAs || '').trim();
  const actorIdentifier = /^urn:multibase:z[^:]+:professional$/.test(controllerSameAs)
    ? controllerSameAs
    : /^urn:multibase:z[^:]+$/.test(controllerSameAs)
      ? `${controllerSameAs}:professional`
      : controllerSameAs.includes('@')
        ? buildStableActorIdentifier({ contactKind: 'email', contact: controllerSameAs, role: 'professional' })
        : '';
  const submittedKeys = mergeActivationJwks(
    [deps.controller?.publicKeyJwk],
    deps.controller?.jwks,
  ).keys as PublicJwk[];

  if (!controllerDid.startsWith('did:web:')) {
    throw new ManagerError('Existing-tenant controller binding requires a stable did:web identifier.', IssueType.Value);
  }
  if (!actorIdentifier) {
    throw new ManagerError('Existing-tenant controller binding requires its stable actor identifier.', IssueType.Required);
  }
  if (submittedKeys.length < 2) {
    throw new ManagerError('Existing-tenant controller binding requires an explicit multi-key JWKS.', IssueType.Required);
  }
  for (const key of submittedKeys) {
    if (PRIVATE_JWK_MEMBERS.some((member) => member in (key as any))) {
      throw new ManagerError('Controller JWKS must contain public keys only.', IssueType.Value);
    }
  }

  const signerKid = String(deps.verifiedSignerKid || '').trim();
  if (!signerKid || !submittedKeys.some((key) => key.kid === signerKid)) {
    throw new ManagerError('The verified request signer must belong to the submitted controller JWKS.', IssueType.Forbidden);
  }

  const alternateName = String(deps.claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
  const sector = String(deps.claims[ClaimsServiceSchemaorg.category] || '').trim() as Sector;
  if (!alternateName || !sector) {
    throw new ManagerError('Controller binding requires tenant alternateName and Service.category.', IssueType.Required);
  }
  if (!deps.hostCollectionName) {
    throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
  }

  const tenantVaultId = getTenantVaultId(sector, alternateName);
  const tenantConfig = await deps.tenantsCacheManager.getTenant(tenantVaultId);
  if (!tenantConfig) {
    throw new ManagerError(`Tenant not found for controller binding: '${tenantVaultId}'.`, IssueType.NotFound);
  }
  const tenantRegistrationDoc = await deps.vaultRepository.get<ConfidentialStorageDoc>(
    deps.hostCollectionName,
    tenantVaultId,
    getEnvSectionId('tenants'),
  );
  if (!tenantRegistrationDoc?.content) {
    throw new ManagerError(`Tenant registry document not found for '${tenantVaultId}'.`, IssueType.NotFound);
  }

  const controllerDidDocument = populateDidDocumentFromJwks({
    '@context': 'https://www.w3.org/ns/did/v1',
    id: controllerDid,
    service: [],
  }, { keys: submittedKeys as any[] });
  const now = new Date().toISOString();
  const updatedConfig = {
    ...tenantConfig,
    didDocument: {
      ...(tenantConfig.didDocument || {}),
      controller: controllerDid,
    },
    meta: {
      ...(tenantConfig.meta || {}),
      controllerDidDocument,
      lastUpdated: now,
    },
  };
  const updatedDoc = {
    ...tenantRegistrationDoc,
    status: updatedConfig.status,
    content: updatedConfig,
  };
  await deps.registerControllerKeysOnLedger?.({
    jurisdiction: String(deps.claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim() || undefined,
    organizationClaims: deps.claims,
    controllerDid,
    actorIdentifier,
    verificationMethods: controllerDidDocument.verificationMethod || [],
    transactionId: deps.transactionId,
  });
  const secureDoc = await deps.kmsService.protectConfidentialData(updatedDoc, 'host');
  await deps.vaultRepository.put(deps.hostCollectionName, [secureDoc], getEnvSectionId('tenants'));
  await deps.tenantsCacheManager.refreshTenant(tenantVaultId);
}
