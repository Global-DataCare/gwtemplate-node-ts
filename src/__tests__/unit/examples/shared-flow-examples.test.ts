import {
  EXAMPLE_INDIVIDUAL_ORGANIZATION_START_INPUT,
  EXAMPLE_LIVE_CONSENT_GRANT_INPUT,
  EXAMPLE_EMPLOYEE_DEVICE_ACTIVATION_INPUT,
  EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD,
  EXAMPLE_OPENID_SMART_TOKEN_INPUT,
  EXAMPLE_ORGANIZATION_EMPLOYEE_INPUT,
  EXAMPLE_SMART_PRESENTATION_SUBMISSION,
} from 'gdc-common-utils-ts/examples/api-flow-examples';

import {
  CONSENT_CREATION_MESSAGE,
  FAMILY_REGISTRATION_REQUEST,
  DCR_REQUEST_BODY,
  EMPLOYEE_REGISTRATION_REQUEST,
  ORGANIZATION_ACTIVATION_REQUEST,
  SMART_TOKEN_REQUEST,
} from '../../data/example-payloads';

describe('shared flow examples conformance', () => {
  it.todo('consumes canonical lifecycle examples from gdc-common-utils-ts/examples/lifecycle once the installed shared package includes that subpath');

  it('keeps organization-controller activation example aligned with shared organization-controller flow examples', () => {
    expect(ORGANIZATION_ACTIVATION_REQUEST.body.vp_token).toBe(EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD.vp_token);
    expect(ORGANIZATION_ACTIVATION_REQUEST.body.controller).toEqual(EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD.controller);
  });

  it('keeps device activation example aligned with shared organization-controller DCR examples', () => {
    expect(DCR_REQUEST_BODY.application_type).toBe(EXAMPLE_EMPLOYEE_DEVICE_ACTIVATION_INPUT.dcrPayload.application_type);
  });

  it('keeps SMART OpenID example aligned with shared professional flow examples', () => {
    expect(SMART_TOKEN_REQUEST.body.vp_token).toBe(EXAMPLE_OPENID_SMART_TOKEN_INPUT.vpToken);
    expect(SMART_TOKEN_REQUEST.body.presentation_submission).toEqual(EXAMPLE_SMART_PRESENTATION_SUBMISSION);
  });

  it('keeps individual onboarding and consent examples on shared individual-controller semantics', () => {
    const familyClaims = FAMILY_REGISTRATION_REQUEST.body.data[0].meta.claims as Record<string, unknown>;
    const consentClaims = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims as Record<string, unknown>;

    expect(typeof FAMILY_REGISTRATION_REQUEST.iss).toBe('string');
    expect(FAMILY_REGISTRATION_REQUEST.iss).toBe(familyClaims['Organization.owner.email']);
    expect(consentClaims['Consent.subject']).toBe('{{individualDid}}');
    expect(consentClaims['Consent.actor-role']).toBe(EXAMPLE_LIVE_CONSENT_GRANT_INPUT.actorRole);
    expect(typeof familyClaims['Organization.owner.email']).toBe('string');
    expect(String(familyClaims['Organization.owner.email'])).toContain('@');
    expect(typeof EXAMPLE_INDIVIDUAL_ORGANIZATION_START_INPUT.controllerEmail).toBe('string');
  });

  it('keeps employee example on canonical role claim key', () => {
    const claims = EMPLOYEE_REGISTRATION_REQUEST.body.data[0].meta.claims as Record<string, unknown>;
    expect(claims).toEqual(
      expect.objectContaining({
        'org.schema.Person.email': EXAMPLE_ORGANIZATION_EMPLOYEE_INPUT.employeeClaims['org.schema.Person.email'],
      }),
    );
    expect(Object.prototype.hasOwnProperty.call(claims, 'org.schema.Person.hasOccupation.identifier.value')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(claims, 'org.schema.Person.hasOccupation')).toBe(false);
  });
});
