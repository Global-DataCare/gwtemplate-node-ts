import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getClaimValue } from '../utils/claims';
import { getProfessionalIdentitySameAs, summarizeProfessionalIdentityCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { findDeviceLicensesByActivationCode } from '../utils/device-license-storage';
import { getEnvSectionId } from '../utils/section-env';
import { getPersonOccupationClaim } from '../utils/occupation';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { resolveRoleBearingEmployeeUrn } from '../utils/urn';

/** Verifies the SDK's identity projection using current protected host records, independently of the VP signature. */
export async function verifyRegisteredProfessionalIdentity(input: {
  credential: Record<string, any>; holder: string; vaultId: string; employeeCollection: string;
  kmsService: IKmsService; vaultRepository: IVaultRepository; now?: number;
}): Promise<{ actorDid: string; acr: string; employeeUrn?: string; role: string; stableActorIdentifier?: string }> {
  const identity = summarizeProfessionalIdentityCredential(input.credential);
  if (!identity || input.credential.issuer || input.credential.iss || input.credential.proof) throw new Error('Unsupported registered professional identity projection.');
  const profileDocument = await input.vaultRepository.get<any>(input.vaultId, input.holder, getEnvSectionId('device-profiles'));
  if (profileDocument?.status !== DeviceBindingStatuses.Active) throw new Error('Professional device registration is inactive.');
  const profile = await input.kmsService.unprotectConfidentialData<any>(profileDocument, input.vaultId);
  if (profile?.clientId !== input.holder || !profile.subjectId || !profile.activationCode) throw new Error('Professional device has no registered employment and licence binding.');
  const licences = await findDeviceLicensesByActivationCode({ activationCode: profile.activationCode, vaultId: input.vaultId,
    sectionId: getEnvSectionId('device-licenses'), vaultRepository: input.vaultRepository, kmsService: input.kmsService });
  if (licences.length !== 1) throw new Error('Professional licence is missing or ambiguous.');
  const licence = licences[0].license;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (licence.status !== 'active' || !Number.isFinite(licence.exp) || licence.exp <= now || licence.subjectId !== profile.subjectId) throw new Error('Professional licence is inactive, expired or belongs to another employee.');
  const deviceActive = Array.isArray(licence.deviceBindings)
    ? licence.deviceBindings.some(binding => binding.clientId === input.holder && binding.status === DeviceBindingStatuses.Active)
    : licence.deviceId === input.holder;
  if (!deviceActive) throw new Error('Professional licence does not authorize this active device.');
  const role = normalizeCodeSystemAndValue(identity.role);
  if (!role || normalizeCodeSystemAndValue(licence.issuedToRole) !== role) throw new Error('Professional role does not match the current licence.');
  const employeeDocument = await input.vaultRepository.get<any>(input.employeeCollection, profile.subjectId, getEnvSectionId('employees'));
  if (employeeDocument?.status !== 'active') throw new Error('Professional employee record is missing or inactive.');
  const employee = await input.kmsService.unprotectConfidentialData<any>(employeeDocument, input.vaultId);
  if (employee?.status !== 'active') throw new Error('Professional employment is inactive.');
  const did = employee.didDocument;
  if (!did || (did.id !== identity.actorDid && !did.alsoKnownAs?.includes(identity.actorDid))) throw new Error('Professional identity does not match its registered employee.');
  const roles = String(getPersonOccupationClaim(employee.claims) || '').split(',').map(value => normalizeCodeSystemAndValue(value.trim()));
  if (!roles.includes(role)) throw new Error('Professional role is not present in current employment.');
  const aliases = new Set(getProfessionalIdentitySameAs({ email: getClaimValue(employee.claims || {}, ClaimsPersonSchemaorg.email), sameAs: getClaimValue(employee.claims || {}, ClaimsPersonSchemaorg.sameAs) }));
  if (profile.stableActorIdentifier) aliases.add(profile.stableActorIdentifier);
  if (identity.sameAs.some(alias => !aliases.has(alias))) throw new Error('Professional continuity alias is not present in its registered identity.');
  return { actorDid: identity.actorDid, acr: 'urn:antifraud:acr:openid4vp:employee', employeeUrn: resolveRoleBearingEmployeeUrn(did), role: identity.role, stableActorIdentifier: profile.stableActorIdentifier };
}
