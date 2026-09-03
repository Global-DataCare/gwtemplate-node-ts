// Flow contract: a registered DCR wallet may bootstrap and poll its first SMART token with an account OIDC bearer, while every other secure actor route remains bearer-bound to the message issuer.
import {
  IdentityAuthActions,
  IdentityAuthResourceTypes,
  SmartPostDcrActions,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  GatewayRouteFormats,
  GatewayRouteSections,
} from 'gdc-common-utils-ts/constants/gateway-response';
import { requiresVerifiedBearerActorBindingForSecureRoute } from '../../../utils/secure-route-bearer-binding';

describe('secure route bearer binding', () => {
  it.each(Object.values(SmartPostDcrActions))(
    'uses DCR wallet proof instead of pre-existing SMART bearer binding for Smart/%s',
    (action) => {
      expect(requiresVerifiedBearerActorBindingForSecureRoute({
        section: GatewayRouteSections.Identity,
        format: GatewayRouteFormats.OpenId,
        resourceType: IdentityAuthResourceTypes.Smart,
        action,
      })).toBe(false);
    },
  );

  it('keeps every other secure action bound to the verified bearer actor', () => {
    expect(requiresVerifiedBearerActorBindingForSecureRoute({
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: IdentityAuthActions.Search,
    })).toBe(true);
  });
});
