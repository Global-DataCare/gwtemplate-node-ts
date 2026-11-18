import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, getIdentifierUrnFromClaims } from './tenant';
import { getEnvSectionId } from './section-env';
import { normalizeIndexedEmail } from './indexed-contact';
import { normalizeCodeSystemAndValue } from './normalize-codeAndSystem';
import { getPersonOccupationClaim } from './occupation';
import { getEmployeeRoleFromUrn, getTenantIdentifierUrnPrefix, parseTenantUrn, resolveRoleBearingEmployeeUrn, createEmployeeUrnFromStableActorIdentifier, normalizeEmployeeRole } from './urn';
import { resolveHostPhysicalCollectionName } from '../config/storage-layout';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { isStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { LICENSE_USER_CLASS_EMPLOYEE, LICENSE_STATUS_ACTIVE, LICENSE_STATUS_ISSUED } from '../constants/domain';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';

type LegacyControllerLicenseInput = Readonly<{
  tenantVaultId: string;
  license: DeviceLicense & Record<string, any>;
  vaultRepository: IVaultRepository;
  kmsService?: IKmsService;
}>;

export type LegacyControllerLicenseBinding = Readonly<{ subjectId: string; employeeUrn: string }>;

/** Resolves a seat from protected current designation and contact; it neither changes keys nor grants a role. */
export async function resolveLegacyControllerLicenseBinding(input: LegacyControllerLicenseInput): Promise<LegacyControllerLicenseBinding> {
  const {license, tenantVaultId, vaultRepository, kmsService} = input;
  const deny = (): never => { throw new ManagerError('Controller licence has no unambiguous current tenant binding.', IssueType.Forbidden); };
  if (!kmsService || license.userClass !== LICENSE_USER_CLASS_EMPLOYEE
    || ![LICENSE_STATUS_ISSUED, LICENSE_STATUS_ACTIVE].includes(license.status as typeof LICENSE_STATUS_ISSUED | typeof LICENSE_STATUS_ACTIVE)
    || (license.exp && Number(license.exp) <= Math.floor(Date.now() / 1000))) return deny();
  const email = normalizeIndexedEmail(license.issuedToEmail || '');
  const role = normalizeCodeSystemAndValue(license.issuedToRole || '');
  const actorIdentifier = email ? normalizeSameAsHash(email) : undefined;
  if (!email || !role || !actorIdentifier
    || (isStableActorIdentifier(license.activatedBy) && license.activatedBy !== actorIdentifier)) return deny();
  const tenantRecord = await vaultRepository.get<ConfidentialStorageDoc>(resolveHostPhysicalCollectionName(), tenantVaultId, getEnvSectionId('tenants'));
  if (!tenantRecord || tenantRecord.id !== tenantVaultId
    || (tenantRecord.status !== undefined && tenantRecord.status !== EntityLifecycleStatus.Active)) return deny();
  const tenant = await kmsService.unprotectConfidentialData<EntityConfig>(tenantRecord, 'host');
  const claims = tenant?.claims;
  if (tenant?.status !== EntityLifecycleStatus.Active || !claims
    || getTenantVaultId(String(claims[ClaimsServiceSchemaorg.category] || ''), String(claims[ClaimsOrganizationSchemaorg.alternateName] || '')) !== tenantVaultId) return deny();
  const collectionName = generateTenantCollectionNameFromClaims(claims);
  const designation = tenant.didDocument?.controller;
  const controllers = [...new Set(typeof designation === 'string' ? [designation] : designation || [])];
  const tenantUrn = getIdentifierUrnFromClaims(claims);
  const declaredScope = tenantUrn ? parseTenantUrn(tenantUrn) : undefined;
  const candidates: LegacyControllerLicenseBinding[] = [];
  for (const controller of controllers) {
    const storedSubjectId = String(license.subjectId || '').trim() || controller;
    const document = await vaultRepository.get<ConfidentialStorageDoc>(collectionName, storedSubjectId, getEnvSectionId('employees'));
    if (!document || document.status === 'inactive' || document.status === 'revoked') continue;
    const employee = await kmsService.unprotectConfidentialData<EntityConfig>(document, tenantVaultId);
    if (employee?.status !== EntityLifecycleStatus.Active || employee.id !== document.id || employee.didDocument?.id !== controller
      || employee.claims?.[ClaimsPersonSchemaorg.additionalType] !== HealthcareActorRoles.Controller) continue;
    const employeeEmail = normalizeIndexedEmail(String(employee.claims?.[ClaimsPersonSchemaorg.email] || ''));
    const employeeSameAs = String(employee.claims?.[ClaimsPersonSchemaorg.sameAs] || '').trim();
    if ((!employeeEmail && !employeeSameAs) || (employeeEmail && employeeEmail !== email)
      || (employeeSameAs && normalizeSameAsHash(employeeSameAs) !== actorIdentifier)) continue;
    const licensedRole = String(license.issuedToRole || '');
    const controllerLicence = normalizeEmployeeRole(licensedRole) === normalizeEmployeeRole(HealthcareActorRoles.Controller);
    if (!controllerLicence && normalizeCodeSystemAndValue(getPersonOccupationClaim(employee.claims) || '') !== role) continue;
    let employeeUrn = resolveRoleBearingEmployeeUrn(employee.didDocument, licensedRole);
    if (!employeeUrn && controllerLicence && tenantUrn && declaredScope) {
      employeeUrn = createEmployeeUrnFromStableActorIdentifier({ organizationUrn: tenantUrn, stableActorIdentifier: actorIdentifier, role: licensedRole });
    }
    const scope = employeeUrn && parseTenantUrn(getTenantIdentifierUrnPrefix(employeeUrn));
    if (!employeeUrn || !scope || normalizeCodeSystemAndValue(getEmployeeRoleFromUrn(employeeUrn) || '') !== role
      || scope.sector !== String(claims[ClaimsServiceSchemaorg.category])
      || scope.jurisdiction.toUpperCase() !== String(claims[ClaimsOrganizationSchemaorg.addressCountry]).toUpperCase()
      || scope.idType.toLowerCase() !== String(claims[ClaimsOrganizationSchemaorg.identifierType]).toLowerCase()
      || scope.idValue !== String(claims[ClaimsOrganizationSchemaorg.identifierValue])
      || (declaredScope && (scope.namespace !== declaredScope.namespace || scope.network !== declaredScope.network || scope.version !== declaredScope.version))) continue;
    candidates.push({subjectId:document.id,employeeUrn});
  }
  if (candidates.length !== 1 || (license.subjectId && license.subjectId !== candidates[0].subjectId)) return deny();
  return candidates[0];
}

export async function resolveLegacyControllerLicenseSubject(input: LegacyControllerLicenseInput): Promise<string> {
  return (await resolveLegacyControllerLicenseBinding(input)).subjectId;
}
