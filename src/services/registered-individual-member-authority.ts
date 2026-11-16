import { parseIndividualMemberDidWeb } from 'gdc-common-utils-ts/utils/did';
import { summarizeIndividualMemberIdentityCredential, getIndividualMemberIdentitySameAs, getIndividualMemberIdentityTelephone } from 'gdc-common-utils-ts/utils/individual-smart';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { LICENSE_USER_CLASS_INDIVIDUAL } from '../constants/domain';
import { getEnvSectionId } from '../utils/section-env';
import { openDeviceLicenseDocument } from '../utils/device-license-storage';
import { normalizeConsentActorRole } from '../utils/consent';

type IndividualMemberAuthorityInput = {
  holder: string; vaultId: string;
  kmsService: IKmsService; vaultRepository: IVaultRepository; now?: number;
};

/** Reads current protected authority; callers authenticate wallet possession before using these facts. */
export async function loadRegisteredIndividualMemberAuthority(input: IndividualMemberAuthorityInput) {
  const document = await input.vaultRepository.get<any>(input.vaultId, input.holder, getEnvSectionId('device-profiles'));
  if (document?.status !== 'active') throw new Error('Individual member device registration is inactive.');
  const profile = await input.kmsService.unprotectConfidentialData<any>(document, input.vaultId);
  if (profile.clientId !== input.holder || !profile.actorDid || !profile.authorizedSubjectDid
    || !profile.licenseId || !profile.authenticatedSubject) throw new Error('Member identity does not match its registered actor and individual subject.');
  const licenceDocument = await input.vaultRepository.get<any>(input.vaultId, profile.licenseId, getEnvSectionId('device-licenses'));
  if (licenceDocument?.status !== 'active') throw new Error('Individual member licence record is missing or inactive.');
  const { license: licence } = await openDeviceLicenseDocument(licenceDocument, input.vaultId, input.kmsService);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (licence.id !== profile.licenseId || licence.status !== 'active' || licence.userClass !== LICENSE_USER_CLASS_INDIVIDUAL
    || !Number.isFinite(licence.exp) || licence.exp <= now) throw new Error('Individual member licence is inactive, expired or invalid.');
  if (licence.authorizedSubjectDid !== profile.authorizedSubjectDid || !licence.subjectId
    || licence.subjectId.replace(/^firebase:/, '') !== String(profile.authenticatedSubject).replace(/^firebase:/, '')) throw new Error('Individual member licence belongs to another subject or person.');
  const deviceActive = Array.isArray(licence.deviceBindings)
    ? licence.deviceBindings.some(binding => binding.clientId === input.holder && binding.status === 'active')
    : licence.deviceId === input.holder;
  if (!deviceActive) throw new Error('Individual member licence does not authorize this device.');
  const role = normalizeConsentActorRole(licence.issuedToRole || '', 'family');
  const actor = parseIndividualMemberDidWeb(profile.actorDid);
  if (!role || actor.individualDidWeb !== profile.authorizedSubjectDid
    || actor.roleValue.toUpperCase() !== role.split('|').at(-1)) throw new Error('Member relationship does not match the current licensed role and individual.');
  return { profile, licence, role };
}

/** Current personal identity/relationship proof. Consent is evaluated separately for every data request. */
export async function verifyRegisteredIndividualMemberIdentity(input: IndividualMemberAuthorityInput & { credential: Record<string, any> }) {
  const identity = summarizeIndividualMemberIdentityCredential(input.credential);
  if (!identity || input.credential.issuer || input.credential.iss || input.credential.proof) throw new Error('Unsupported registered individual-member identity projection.');
  const { profile, licence, role } = await loadRegisteredIndividualMemberAuthority(input);
  if (profile.actorDid !== identity.actorDid || profile.authorizedSubjectDid !== identity.subjectDid) throw new Error('Member identity targets another individual or actor.');
  if (normalizeConsentActorRole(identity.relationship, 'family') !== role) throw new Error('Member relationship does not match its current licence.');
  const aliases = new Set(getIndividualMemberIdentitySameAs({ email: licence.issuedToEmail }));
  if (identity.sameAs.some(alias => !aliases.has(alias))) throw new Error('Member contact alias does not match its current licence.');
  if (identity.email && identity.email !== String(licence.issuedToEmail || '').trim().toLowerCase()) throw new Error('Member email does not match its current licence.');
  if (identity.telephone && identity.telephone !== getIndividualMemberIdentityTelephone({ telephone: licence.issuedToPhone })) throw new Error('Member telephone does not match its current licence.');
  return { actorDid: identity.actorDid, subjectDid: identity.subjectDid, role: identity.relationship, acr: 'urn:antifraud:acr:openid4vp:individual',
    email: licence.issuedToEmail, phone: licence.issuedToPhone, sameAs: identity.sameAs };
}
