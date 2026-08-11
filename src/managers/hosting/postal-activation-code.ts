import { scryptSync, timingSafeEqual } from 'node:crypto';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

export const POSTAL_CODE_ALGORITHM_CLAIM = 'gdc.activationLicense.codeAlgorithm';
export const POSTAL_CODE_SALT_CLAIM = 'gdc.activationLicense.codeSalt';
export const POSTAL_CODE_DIGEST_CLAIM = 'gdc.activationLicense.codeDigest';
// Order input is authored as `gdc.activationLicense.code` under org.schema
// context and reaches managers in this normalized form.
export const POSTAL_CODE_INPUT_CLAIM = 'org.schema.gdc.activationLicense.code';

/** Verifies one clear Order code against the protected VC binding without logging the secret. */
export function verifyBoundPostalActivationCode(
  orderClaims: Record<string, unknown>, registrationClaims: Record<string, unknown>, pepper: string | undefined,
): string {
  const code = String(orderClaims[POSTAL_CODE_INPUT_CLAIM] || '').trim().toUpperCase();
  const algorithm = String(registrationClaims[POSTAL_CODE_ALGORITHM_CLAIM] || '');
  const salt = String(registrationClaims[POSTAL_CODE_SALT_CLAIM] || '');
  const digest = String(registrationClaims[POSTAL_CODE_DIGEST_CLAIM] || '');
  const normalizedPepper = String(pepper || '').trim();
  if (!code || algorithm !== 'scrypt-v1' || !salt || !digest || !normalizedPepper) {
    throw new ManagerError('Postal activation code binding is incomplete.', IssueType.Security);
  }
  const actual = scryptSync(`${code}:${normalizedPepper}`, salt, 32);
  const expected = Buffer.from(digest, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ManagerError('Postal activation code does not match the delivered licence.', IssueType.Security);
  }
  return code;
}
