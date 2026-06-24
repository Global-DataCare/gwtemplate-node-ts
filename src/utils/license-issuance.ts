// src/utils/license-issuance.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomBytes } from 'crypto';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
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
  email: string;
  role: string;
};

/**
 * Reserves one available license from the tenant pool (`device-licenses`) by generating an activation code.
 *
 * This performs the transition:
 * - `available` -> `issued`
 * - adds `activationCode` and invitation metadata (`issuedToEmail`, `issuedToRole`)
 * - optionally HMAC-indexes the activation code for safe lookups (if KMS is provided)
 */
export async function issueActivationCodeFromPool(params: IssueActivationCodeParams): Promise<{
  activationCode: string;
  licenseId: string;
}> {
  const { vaultRepository, kmsService, tenantVaultId, userClass, type, email, role } = params;

  const all = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(tenantVaultId, getEnvSectionId('device-licenses'));
  const normalizedEmail = normalizeIndexedEmail(email);
  const normalizedRole = normalizeCodeSystemAndValue(role);
  const now = Math.floor(Date.now() / 1000);

  const actorMatches = all.filter((doc) => {
    const license = doc?.content as any;
    if (!license || license.userClass !== userClass) {
      return false;
    }
    if (license.exp && Number(license.exp) < now) {
      return false;
    }
    const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
    const issuedRole = normalizeCodeSystemAndValue(String(license.issuedToRole || ''));
    return Boolean(issuedEmail && issuedRole && issuedEmail === normalizedEmail && issuedRole === normalizedRole);
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

  const availableSameType = all.find((doc) => {
    const license = doc?.content as any;
    const status = String((license && license.status) || doc.status || '');
    return (
      license &&
      license.userClass === userClass &&
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
      status === LICENSE_STATUS_AVAILABLE &&
      !license.activationCode
    );
  });
  const match = existingMatch || availableSameType || availableAnyType;

  if (!match) {
    throw new Error(`No reusable or available license found for userClass='${userClass}'.`);
  }

  const activationCode = `lic-${randomBytes(9).toString('base64url')}`;

  const license = match.content as DeviceLicense & Record<string, any>;
  license.activationCode = activationCode;
  license.issuedToEmail = email;
  license.issuedToRole = role;
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

  return { activationCode, licenseId: match.id };
}
