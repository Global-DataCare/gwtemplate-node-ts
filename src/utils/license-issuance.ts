// src/utils/license-issuance.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomBytes } from 'crypto';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getEnvSectionId } from './section-env';
import {
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_TYPE_WEB,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
} from '../constants/domain';

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
  const match = all.find((doc) => {
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

  if (!match) {
    throw new Error(`No available license found for userClass='${userClass}' and type='${type}'.`);
  }

  const activationCode = `lic-${randomBytes(9).toString('base64url')}`;
  const now = Math.floor(Date.now() / 1000);

  const license = match.content as DeviceLicense & Record<string, any>;
  license.activationCode = activationCode;
  license.issuedToEmail = email;
  license.issuedToRole = role;
  license.issuedAt = now;
  license.status = LICENSE_STATUS_ISSUED;

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
