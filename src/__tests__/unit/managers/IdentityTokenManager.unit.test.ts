import { describe, expect, it, jest } from '@jest/globals';
import {
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_DEMO_PORTAL_ID_TOKEN,
  EXAMPLE_EMAIL_CONTROLLER_ORG,
  EXAMPLE_EMPLOYEE_ACTIVATION_CODE,
  EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_PRIMARY,
  EXAMPLE_SECTOR,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { IdentityTokenManager } from '../../../managers/IdentityTokenManager';

jest.mock('../../../auth/OidcFederationService', () => ({
  federateOidcIdTokenToFirebaseCustomToken: jest.fn(),
}));

/**
 * Token/_exchange trust contract: Firebase proves the user/contact while the
 * already validated request route selects the tenant. A custom tenant_id claim
 * is optional and, when present, may only narrow that route selection.
 */
describe('IdentityTokenManager route-owned tenant exchange', () => {
  function buildHarness(tokenPayload: Record<string, unknown>) {
    const verifyIdToken = jest.fn(async () => ({ payload: tokenPayload }));
    const verifyAndConsumeActivationCode = jest.fn(async () => undefined);
    const createInitialAccessToken = jest.fn(async () => EXAMPLE_DEMO_PORTAL_ID_TOKEN);
    const manager = new IdentityTokenManager(
      { verifyIdToken, verifyAndConsumeActivationCode } as any,
      { createInitialAccessToken } as any,
    );
    const job = {
      action: '_exchange',
      tenantId: EXAMPLE_TENANT_IDENTIFIER,
      sector: EXAMPLE_SECTOR,
      content: {
        thid: 'exchange-route-tenant',
        meta: { bearer: { token: `Bearer ${EXAMPLE_DEMO_PORTAL_ID_TOKEN}` } },
        body: {
          subject_token: EXAMPLE_EMPLOYEE_ACTIVATION_CODE,
          client_instance_id: EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_PRIMARY,
        },
      },
    } as any;
    return { manager, job, verifyAndConsumeActivationCode, createInitialAccessToken };
  }

  it('uses the validated route tenant when a Firebase id_token has no tenant_id claim', async () => {
    const harness = buildHarness({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      email: EXAMPLE_EMAIL_CONTROLLER_ORG,
      email_verified: true,
    });

    const response = await harness.manager.process(harness.job);

    expect(harness.verifyAndConsumeActivationCode as any).toHaveBeenCalledWith(
      EXAMPLE_EMPLOYEE_ACTIVATION_CODE,
      EXAMPLE_TENANT_IDENTIFIER,
      EXAMPLE_SECTOR,
      expect.objectContaining({ subject: EXAMPLE_ACCOUNT_OWNER_ID }),
      EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_PRIMARY,
    );
    expect(harness.createInitialAccessToken as any).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: EXAMPLE_TENANT_IDENTIFIER }),
      60,
    );
    expect(response.body).toEqual(expect.objectContaining({
      initial_access_token: EXAMPLE_DEMO_PORTAL_ID_TOKEN,
    }));
  });

  it('rejects an optional token tenant_id that conflicts with the validated route tenant', async () => {
    const harness = buildHarness({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      tenant_id: 'different-tenant',
      email: EXAMPLE_EMAIL_CONTROLLER_ORG,
      email_verified: true,
    });

    await expect(harness.manager.process(harness.job)).rejects.toThrow(/tenant_id.*route tenant/i);
    expect(harness.verifyAndConsumeActivationCode).not.toHaveBeenCalled();
  });
});
