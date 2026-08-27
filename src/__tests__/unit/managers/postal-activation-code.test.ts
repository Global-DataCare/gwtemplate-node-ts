// TDD contract: write this test red first; make it green only with the complete real behavior.
/** One-code contract: Order may issue only the code bound by the delivered postal VC. */
import { scryptSync } from 'node:crypto';
import { ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM, type PostalActivationCodeBinding } from 'gdc-common-utils-ts/utils/organization-test-network-credential';
import {
  EXAMPLE_POSTAL_ACTIVATION_CODE,
  EXAMPLE_POSTAL_ACTIVATION_CODE_INVALID,
  EXAMPLE_POSTAL_ACTIVATION_PEPPER,
  EXAMPLE_POSTAL_ACTIVATION_SALT,
} from 'gdc-common-utils-ts/examples/shared';
import { verifyBoundPostalActivationCode } from '../../../managers/hosting/postal-activation-code';

describe('postal activation code binding', () => {
  const code = EXAMPLE_POSTAL_ACTIVATION_CODE;
  const pepper = EXAMPLE_POSTAL_ACTIVATION_PEPPER;
  const salt = EXAMPLE_POSTAL_ACTIVATION_SALT;
  const binding: PostalActivationCodeBinding = {
    algorithm: POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM,
    salt,
    digest: scryptSync(`${code}:${pepper}`, salt, 32).toString('base64url'),
  };

  it('accepts only the exact delivered code and configured pepper', () => {
    expect(verifyBoundPostalActivationCode({ [ClaimsOrderSchemaorg.confirmationNumber]: code }, binding, pepper)).toBe(code);
    expect(() => verifyBoundPostalActivationCode({ [ClaimsOrderSchemaorg.confirmationNumber]: EXAMPLE_POSTAL_ACTIVATION_CODE_INVALID }, binding, pepper))
      .toThrow('does not match');
  });
});
