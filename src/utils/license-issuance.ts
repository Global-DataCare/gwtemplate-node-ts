// src/utils/license-issuance.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomBytes, randomUUID } from 'crypto';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { DEFAULT_LICENSE_DEVICE_ALLOWANCE } from 'gdc-common-utils-ts/utils/license';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getEnvSectionId } from './section-env';
import {
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_TYPE_WEB,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
} from '../constants/domain';
import { normalizeIndexedEmail } from './indexed-contact';
import { normalizeCodeSystemAndValue } from './normalize-codeAndSystem';

export type IssueActivationCodeParams = {
  vaultRepository: IVaultRepository;
  kmsService?: IKmsService;
  tenantVaultId: string;
  userClass: typeof LICENSE_USER_CLASS_EMPLOYEE | typeof LICENSE_USER_CLASS_INDIVIDUAL;
  type: typeof LICENSE_TYPE_MOBILE | typeof LICENSE_TYPE_WEB;
  email?: string;
  phone?: string;
  role: string;
  ownerOrganizationId?: string;
  relatedPersonId?: string;
  invitationId?: string;
  /** DID of the represented person/animal, never the DID of a physical card or PETD. */
  subjectDid?: string;
  /** Pre-verified code for a host-authorized postal licence; never log it. */
  activationCode?: string;
};

export type MaterializeFreeIndividualLicensesParams = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  tenantId: string;
  ownerOrganizationId: string;
  quantity: number;
  /** When true, quantity is the desired pool total rather than seats to add. */
  ensureTotal?: boolean;
  /** Assigns the first created seat to the individual controller. */
  controllerSubjectId?: string;
  /** DID of the represented person/animal authorized for this seat. */
  controllerAuthorizedSubjectDid?: string;
  /** Relationship carried by the controller's active subject grant. */
  controllerRelationshipRole?: string;
  controllerEmail?: string;
  controllerPhone?: string;
  nowEpochSeconds?: number;
};

export type ReserveTechnicalControllerSeatParams = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  representativeLicenseId?: string;
  nowEpochSeconds?: number;
};

function isServiceControllerRole(value: unknown): boolean {
  const normalized = normalizeCodeSystemAndValue(String(value || ''));
  return normalized === 'resprsn' || normalized.endsWith(':resprsn');
}

/**
 * Reserves the second initial employee seat for a later technical controller.
 *
 * The reservation is intentionally contact-free until the service controller
 * proves its own email/key binding through `Organization/_issue`. It therefore
 * counts as assigned but exposes no invented person. Existing bound controller
 * seats are reused. This operation never creates a third seat: an existing
 * organization whose second seat belongs to a professional must purchase a
 * new seat before another technical controller can bind.
 */
export async function reserveTechnicalControllerSeat(
  params: ReserveTechnicalControllerSeatParams,
): Promise<ConfidentialStorageDoc> {
  const sectionId = getEnvSectionId('device-licenses');
  const all = await params.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
    params.tenantVaultId,
    sectionId,
  );
  const employeeSeats = all.filter((doc) =>
    (doc.content as DeviceLicense | undefined)?.userClass === LICENSE_USER_CLASS_EMPLOYEE);
  const existing = employeeSeats.find((doc) =>
    doc.id !== params.representativeLicenseId
      && isServiceControllerRole((doc.content as DeviceLicense | undefined)?.issuedToRole)
      && [LICENSE_STATUS_ISSUED, LICENSE_STATUS_ACTIVE].includes(
        (doc.content as DeviceLicense).status as typeof LICENSE_STATUS_ISSUED | typeof LICENSE_STATUS_ACTIVE,
      ));
  if (existing) return existing;

  const now = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const document = employeeSeats.find((doc) =>
    doc.id !== params.representativeLicenseId
      && (doc.content as DeviceLicense | undefined)?.status === LICENSE_STATUS_AVAILABLE);
  if (!document) {
    throw new Error('No available initial seat remains for the technical controller reservation.');
  }
  const license = document.content as DeviceLicense & Record<string, unknown>;
  license.status = LICENSE_STATUS_ISSUED;
  license.issuedToRole = 'RESPRSN';
  license.issuedAt = now;
  delete license.issuedToEmail;
  delete license.issuedToPhone;
  delete license.activationCode;
  document.status = LICENSE_STATUS_ISSUED;
  document.sequence = Number(document.sequence || 0) + 1;
  await params.vaultRepository.put(params.tenantVaultId, [document], sectionId);
  return document;
}

/**
 * Materializes zero-cost seats for one hosted individual organization.
 *
 * This is deliberately scoped by `ownerOrganizationId`: several individual
 * organizations can coexist in the same UNID tenant vault and must never
 * borrow each other's member seats.
 *
 * Organization onboarding uses `ensureTotal=true`, an initial quantity and a
 * controller id. Later additions belong to the Offer -> Order lifecycle; this
 * helper is not a public licence-mutation route.
 */
export async function materializeFreeIndividualLicenses(
  params: MaterializeFreeIndividualLicensesParams,
): Promise<ConfidentialStorageDoc[]> {
  if (!params.ownerOrganizationId.trim()) throw new Error('ownerOrganizationId is required.');
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('Individual license quantity must be a positive integer.');
  }

  const sectionId = getEnvSectionId('device-licenses');
  const all = await params.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(params.tenantVaultId, sectionId);
  const owned = all.filter((doc) => {
    const license = doc?.content as DeviceLicense | undefined;
    return license?.userClass === LICENSE_USER_CLASS_INDIVIDUAL
      && license.ownerOrganizationId === params.ownerOrganizationId;
  });
  const now = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const expiry = now + 31_536_000;
  const controllerDocument = owned.find((doc) => {
    const license = doc.content as DeviceLicense | undefined;
    return license?.subjectId === params.controllerSubjectId
      && license?.status === LICENSE_STATUS_ACTIVE;
  });
  const controllerAlreadyAssigned = Boolean(controllerDocument);
  const documents: ConfidentialStorageDoc[] = [];

  // Registrations created before the authoritative subject-directory contract
  // have an active controller seat but no card/subject binding. Repair that
  // exact seat idempotently so portal and telephone lookup converge on GW.
  if (controllerDocument) {
    const current = controllerDocument.content as DeviceLicense & Record<string, unknown>;
    const next = {
      ...current,
      ...(!current.authorizedSubjectDid && params.controllerAuthorizedSubjectDid
        ? { authorizedSubjectDid: params.controllerAuthorizedSubjectDid }
        : {}),
      ...(!current.issuedToRole && params.controllerRelationshipRole
        ? { issuedToRole: normalizeControllerRelationshipRole(params.controllerRelationshipRole) }
        : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      documents.push({
        ...controllerDocument,
        sequence: (controllerDocument.sequence || 0) + 1,
        content: next as DeviceLicense,
      });
    }
  }

  const seatsToCreate = params.ensureTotal
    ? Math.max(0, params.quantity - owned.length)
    : params.quantity;

  for (let index = 0; index < seatsToCreate; index += 1) {
    const assignController = Boolean(params.controllerSubjectId)
      && !controllerAlreadyAssigned
      && index === 0;
    const id = randomUUID();
    const status = assignController ? LICENSE_STATUS_ACTIVE : LICENSE_STATUS_AVAILABLE;
    const license: DeviceLicense = {
      id,
      tenantId: params.tenantId,
      ownerOrganizationId: params.ownerOrganizationId,
      orderId: `individual-default-free:${params.ownerOrganizationId}`,
      userClass: LICENSE_USER_CLASS_INDIVIDUAL,
      type: LICENSE_TYPE_WEB,
      status,
      plan: 'individual-default-free',
      renewalCycle: null,
      reactivationEnabled: true,
      exp: expiry,
      ...(assignController ? {
        subjectId: params.controllerSubjectId,
        ...(params.controllerAuthorizedSubjectDid ? { authorizedSubjectDid: params.controllerAuthorizedSubjectDid } : {}),
        ...(params.controllerEmail ? { issuedToEmail: params.controllerEmail } : {}),
        ...(params.controllerPhone ? { issuedToPhone: params.controllerPhone } : {}),
        issuedToRole: normalizeControllerRelationshipRole(params.controllerRelationshipRole),
        activatedAt: now,
      } : {}),
    };
    documents.push({ id, status, sequence: 0, content: license });
  }

  if (documents.length > 0) {
    await params.vaultRepository.put(params.tenantVaultId, documents, sectionId);
  }
  return documents;
}

function normalizeControllerRelationshipRole(role?: string): string {
  const value = String(role || 'ONESELF').trim().split('|').at(-1)?.toUpperCase() || 'ONESELF';
  return `v3-RoleCode|${value}`;
}

/**
 * Reserves one available license from the tenant pool (`device-licenses`) by generating an activation code.
 *
 * This performs the transition:
 * - `available` -> `issued`
 * - adds `activationCode` and invitation metadata
 * - when `ownerOrganizationId` is present, never borrows a seat from another
 *   individual organization hosted in the same UNID tenant
 * - optionally HMAC-indexes the activation code for safe lookups (if KMS is provided)
 */
export async function issueActivationCodeFromPool(params: IssueActivationCodeParams): Promise<{
  activationCode: string;
  licenseId: string;
  maxDevices: number;
}> {
  const {
    vaultRepository,
    kmsService,
    tenantVaultId,
    userClass,
    type,
    email,
    phone,
    role,
    ownerOrganizationId,
    relatedPersonId,
    invitationId,
    subjectDid,
  } = params;

  const all = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(tenantVaultId, getEnvSectionId('device-licenses'));
  const normalizedEmail = normalizeIndexedEmail(email || '');
  const normalizedPhone = String(phone || '').replace(/[\s()-]/g, '');
  const normalizedRole = normalizeCodeSystemAndValue(role);
  const now = Math.floor(Date.now() / 1000);

  const actorMatches = all.filter((doc) => {
    const license = doc?.content as any;
    if (!license || license.userClass !== userClass) {
      return false;
    }
    if (ownerOrganizationId && license.ownerOrganizationId !== ownerOrganizationId) return false;
    if (license.exp && Number(license.exp) < now) {
      return false;
    }
    const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
    const issuedPhone = String(license.issuedToPhone || '').replace(/[\s()-]/g, '');
    const issuedRole = normalizeCodeSystemAndValue(String(license.issuedToRole || ''));
    const sameRecipient = normalizedEmail
      ? issuedEmail === normalizedEmail
      : Boolean(normalizedPhone && issuedPhone === normalizedPhone);
    return Boolean(sameRecipient && issuedRole && issuedRole === normalizedRole);
  });

  const existingMatch = actorMatches
    .sort((left, right) => {
      const leftLicense = left.content as any;
      const rightLicense = right.content as any;
      const leftTypeScore = leftLicense?.type === type ? 1 : 0;
      const rightTypeScore = rightLicense?.type === type ? 1 : 0;
      if (leftTypeScore !== rightTypeScore) return rightTypeScore - leftTypeScore;
      const leftStatus = String(leftLicense?.status || left.status || '');
      const rightStatus = String(rightLicense?.status || right.status || '');
      const leftReusableScore = leftStatus === LICENSE_STATUS_ACTIVE || leftStatus === LICENSE_STATUS_ISSUED ? 1 : 0;
      const rightReusableScore = rightStatus === LICENSE_STATUS_ACTIVE || rightStatus === LICENSE_STATUS_ISSUED ? 1 : 0;
      if (leftReusableScore !== rightReusableScore) return rightReusableScore - leftReusableScore;
      return Number(right.sequence || 0) - Number(left.sequence || 0);
    })[0];

  // Order polling and browser retries may ask for the same representative
  // access after the tenant is already active. Return the original material
  // without rotating it or mutating the seat; the following Token exchange is
  // the operation that consumes it.
  const existingActivationCode = String(
    (existingMatch?.content as DeviceLicense & Record<string, unknown> | undefined)?.activationCode || '',
  ).trim();
  if (existingMatch && existingActivationCode) {
    const configuredAllowance = Number(
      (existingMatch.content as DeviceLicense & Record<string, unknown>).maxDevices,
    );
    return {
      activationCode: existingActivationCode,
      licenseId: existingMatch.id,
      maxDevices: Number.isInteger(configuredAllowance) && configuredAllowance > 0
        ? configuredAllowance
        : DEFAULT_LICENSE_DEVICE_ALLOWANCE,
    };
  }

  const availableSameType = all.find((doc) => {
    const license = doc?.content as any;
    const status = String((license && license.status) || doc.status || '');
    return (
      license &&
      license.userClass === userClass &&
      (!ownerOrganizationId || license.ownerOrganizationId === ownerOrganizationId) &&
      license.type === type &&
      status === LICENSE_STATUS_AVAILABLE &&
      !license.activationCode
    );
  });
  const availableAnyType = all.find((doc) => {
    const license = doc?.content as any;
    const status = String((license && license.status) || doc.status || '');
    return (
      license &&
      license.userClass === userClass &&
      (!ownerOrganizationId || license.ownerOrganizationId === ownerOrganizationId) &&
      status === LICENSE_STATUS_AVAILABLE &&
      !license.activationCode
    );
  });
  const reservedControllerSeat = userClass === LICENSE_USER_CLASS_EMPLOYEE
    && isServiceControllerRole(normalizedRole)
    ? all.find((doc) => {
        const license = doc?.content as DeviceLicense & Record<string, unknown> | undefined;
        return license?.userClass === LICENSE_USER_CLASS_EMPLOYEE
          && license.status === LICENSE_STATUS_ISSUED
          && !license.issuedToEmail
          && !license.issuedToPhone
          && !license.activationCode
          && isServiceControllerRole(license.issuedToRole);
      })
    : undefined;
  const match = existingMatch || reservedControllerSeat || availableSameType || availableAnyType;

  if (!match) {
    throw new Error(`No reusable or available license found for userClass='${userClass}'.`);
  }

  const activationCode = params.activationCode || `lic-${randomBytes(9).toString('base64url')}`;

  const license = match.content as DeviceLicense & Record<string, any>;
  license.activationCode = activationCode;
  if (email) license.issuedToEmail = email;
  else delete license.issuedToEmail;
  if (phone) license.issuedToPhone = phone;
  else delete license.issuedToPhone;
  license.issuedToRole = role;
  if (ownerOrganizationId) license.ownerOrganizationId = ownerOrganizationId;
  if (relatedPersonId) license.relatedPersonId = relatedPersonId;
  if (invitationId) license.invitationId = invitationId;
  if (subjectDid) license.authorizedSubjectDid = subjectDid;
  license.issuedAt = now;
  license.status = LICENSE_STATUS_ISSUED;
  delete license.activatedAt;
  delete license.deviceId;
  delete license.deviceInfo;

  match.status = LICENSE_STATUS_ISSUED;
  match.sequence = (match.sequence || 0) + 1;

  if (kmsService) {
    const attrs = await kmsService.protectAttributesNameAndValue(
      [{ name: 'activationCode', value: activationCode, unique: true, type: 'string' }],
      tenantVaultId,
    );
    match.indexed = { ...(match.indexed || {}), attributes: attrs };
  }

  await vaultRepository.put(tenantVaultId, [match], getEnvSectionId('device-licenses'));

  const configuredAllowance = Number(license.maxDevices);
  const maxDevices = Number.isInteger(configuredAllowance) && configuredAllowance > 0
    ? configuredAllowance
    : DEFAULT_LICENSE_DEVICE_ALLOWANCE;
  return { activationCode, licenseId: match.id, maxDevices };
}
