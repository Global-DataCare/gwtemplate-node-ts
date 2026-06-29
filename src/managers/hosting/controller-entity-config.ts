import type { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { DidDocument, VerificationMethod } from 'gdc-common-utils-ts/models/did';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { ParameterData } from 'gdc-common-utils-ts/models/params';
import type { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { EntityConfig } from '../../gdc-backend-utils-node/models/entity';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { normalizeCodeSystemAndValue } from '../../utils/normalize-codeAndSystem';
import { getPersonOccupationClaim } from '../../utils/occupation';
import { normalizeIndexedEmail } from '../../utils/indexed-contact';
import { getEnvSectionId } from '../../utils/section-env';
import { createEmployeeUrn, parseTenantUrn } from '../../utils/urn';
import { populateDidDocumentFromJwks } from '../../utils/did-backend';

export type ActivationParticipantMaterialLike = Readonly<{
  did?: string;
  sameAs?: string;
  publicKeyJwk?: PublicJwk;
  jwks?: JwkSet;
}>;

export type ControllerRegistrationKeys = Readonly<{
  signerJwk?: PublicJwk;
  encrypterJwk?: PublicJwk;
}>;

type BuildControllerEntityConfigDeps = Readonly<{
  legalRep: IncludedResource;
  tenantUrn: string;
  kmsService: IKmsService;
  mergeActivationJwks: (keys: Array<PublicJwk | undefined>, jwks?: JwkSet) => JwkSet;
  findJwkByUse: (jwks: JwkSet | undefined, use: 'sig' | 'enc') => PublicJwk | undefined;
  isSignatureJwk: (key: PublicJwk) => boolean;
  isEncryptionJwk: (key: PublicJwk) => boolean;
  registrationKeys?: ControllerRegistrationKeys;
  explicitBinding?: ActivationParticipantMaterialLike;
}>;

type StoreControllerEntityConfigDeps = Readonly<{
  controllerConfig: EntityConfig;
  tenantCollectionName: string;
  vaultId: string;
  kmsService: IKmsService;
  vaultRepository: IVaultRepository;
  bootstrapLifecycleRole: string;
}>;

/**
 * Builds the synthetic bootstrap controller employee used during tenant
 * onboarding.
 *
 * Required input claims on `legalRep.meta.claims`:
 * - `Person.email`
 * - `Person.hasOccupation`
 */
export async function buildControllerEntityConfig(
  deps: BuildControllerEntityConfigDeps,
): Promise<EntityConfig> {
  const email = normalizeIndexedEmail(deps.legalRep.meta?.claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
  const roleCode = getPersonOccupationClaim(deps.legalRep.meta?.claims as Record<string, any> | undefined);
  if (!email || !roleCode) {
    throw new ManagerError('Missing required admin Person claims (email, hasOccupation).', IssueType.Required);
  }

  const parsedTenantUrn = parseTenantUrn(deps.tenantUrn);
  if (!parsedTenantUrn) {
    throw new ManagerError(`Invalid tenant URN format: '${deps.tenantUrn}'`, IssueType.Value);
  }

  const employeeUrn = createEmployeeUrn({
    namespace: parsedTenantUrn.namespace,
    network: parsedTenantUrn.network,
    jurisdiction: parsedTenantUrn.jurisdiction,
    version: parsedTenantUrn.version,
    sector: parsedTenantUrn.sector,
    idType: parsedTenantUrn.idType,
    idValue: parsedTenantUrn.idValue,
    email,
    role: roleCode,
  });

  let signerJwk = deps.explicitBinding?.publicKeyJwk
    || deps.findJwkByUse(deps.explicitBinding?.jwks, 'sig')
    || deps.registrationKeys?.signerJwk;
  let encrypterJwk = deps.findJwkByUse(deps.explicitBinding?.jwks, 'enc')
    || deps.registrationKeys?.encrypterJwk;
  if (!signerJwk || !encrypterJwk) {
    const provisioned = await deps.kmsService.provisionKeys(employeeUrn);
    signerJwk = signerJwk || provisioned.keys.find((key) => (key as any).kty === 'AKP') as PublicJwk | undefined;
    encrypterJwk = encrypterJwk || provisioned.keys.find((key) => (key as any).kty === 'OKP') as PublicJwk | undefined;
  }
  if (!signerJwk?.kid || !encrypterJwk?.kid) {
    throw new ManagerError('Admin keys are missing "kid" properties.', IssueType.Required);
  }

  const didId = deps.explicitBinding?.did || employeeUrn;
  const alsoKnownAs = Array.from(new Set([
    didId !== employeeUrn ? employeeUrn : undefined,
    deps.explicitBinding?.sameAs,
  ].filter((value): value is string => Boolean(value))));

  const mergedJwks = deps.mergeActivationJwks([signerJwk, encrypterJwk], deps.explicitBinding?.jwks);
  const didDocument: DidDocument = didId.startsWith('did:web:')
    ? populateDidDocumentFromJwks(
      {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: didId,
        ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
        service: [],
      },
      mergedJwks,
    )
    : (() => {
      const verificationMethod: VerificationMethod[] = [];
      const assertionMethod: string[] = [];
      const keyAgreement: string[] = [];
      for (const key of mergedJwks.keys as PublicJwk[]) {
        const keyId = `${didId}#${key.kid}`;
        verificationMethod.push({
          id: keyId,
          controller: didId,
          type: 'JsonWebKey2020',
          publicKeyJwk: key,
        });
        if (deps.isSignatureJwk(key)) {
          assertionMethod.push(keyId);
        }
        if (deps.isEncryptionJwk(key)) {
          keyAgreement.push(keyId);
        }
      }
      return {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: didId,
        ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
        verificationMethod,
        assertionMethod,
        keyAgreement,
        service: [],
      } as DidDocument;
    })();

  const verificationMethods = didDocument.verificationMethod || [];
  const signerMethodId = verificationMethods.find((method) => (method.publicKeyJwk as any)?.kid === signerJwk?.kid)?.id;

  return {
    id: deps.legalRep.id,
    type: EntityType.Person,
    status: EntityLifecycleStatus.Active,
    claims: deps.legalRep.meta?.claims || {},
    didDocument: {
      ...didDocument,
      authentication: signerMethodId ? [signerMethodId] : didDocument.authentication,
    },
    didConfig: { service: [] },
    meta: { lastUpdated: new Date().toISOString() },
  };
}

/**
 * Persists the synthetic bootstrap controller employee created to initialize a
 * hosted tenant.
 */
export async function storeControllerEntityConfig(
  deps: StoreControllerEntityConfigDeps,
): Promise<void> {
  const verificationMethods = deps.controllerConfig.didDocument?.verificationMethod || [];
  const email = normalizeIndexedEmail(deps.controllerConfig.claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
  const roleCode = getPersonOccupationClaim(deps.controllerConfig.claims as Record<string, any> | undefined);

  const attributesToIndex: ParameterData[] = [
    ...(email ? [{ name: 'email', value: email, unique: true, type: 'string' } as ParameterData] : []),
    ...(roleCode ? [{ name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' } as ParameterData] : []),
    { name: 'lifecycleRole', value: deps.bootstrapLifecycleRole, unique: false, type: 'string' } as ParameterData,
    ...verificationMethods
      .map((vm) => (vm.publicKeyJwk as PublicJwk | undefined)?.kid)
      .filter((kid): kid is string => Boolean(kid))
      .map((kid) => ({ name: 'kid', value: kid, unique: false, type: 'string' } as ParameterData)),
  ];
  const protectedAttributes = await deps.kmsService.protectAttributesNameAndValue(attributesToIndex, deps.vaultId);

  const employeeDoc: ConfidentialStorageDoc = {
    id: deps.controllerConfig.id,
    status: deps.controllerConfig.status,
    sequence: 0,
    content: deps.controllerConfig,
    indexed: { attributes: protectedAttributes },
    public: {
      role: deps.bootstrapLifecycleRole,
    },
  };
  const secureEmployeeDoc = await deps.kmsService.protectConfidentialData(employeeDoc, deps.vaultId);
  await deps.vaultRepository.put(deps.tenantCollectionName, [secureEmployeeDoc], getEnvSectionId('employees'));
}
