/** One-code contract: Order may issue only the code bound by the delivered postal VC. */
import { scryptSync } from 'node:crypto';
import {
  POSTAL_CODE_ALGORITHM_CLAIM, POSTAL_CODE_DIGEST_CLAIM, POSTAL_CODE_INPUT_CLAIM,
  POSTAL_CODE_SALT_CLAIM, verifyBoundPostalActivationCode,
} from '../../../managers/hosting/postal-activation-code';

describe('postal activation code binding', () => {
  const code = 'UNID-ABC1234567';
  const pepper = 'host-shared-secret';
  const salt = 'base64url-salt';
  const registration = {
    [POSTAL_CODE_ALGORITHM_CLAIM]: 'scrypt-v1',
    [POSTAL_CODE_SALT_CLAIM]: salt,
    [POSTAL_CODE_DIGEST_CLAIM]: scryptSync(`${code}:${pepper}`, salt, 32).toString('base64url'),
  };

  it('accepts only the exact delivered code and configured pepper', () => {
    expect(verifyBoundPostalActivationCode({ [POSTAL_CODE_INPUT_CLAIM]: code }, registration, pepper)).toBe(code);
    expect(() => verifyBoundPostalActivationCode({ [POSTAL_CODE_INPUT_CLAIM]: 'UNID-WRONG00000' }, registration, pepper))
      .toThrow('does not match');
  });
});
