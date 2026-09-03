import {
  IdentityAuthResourceTypes,
  SmartPostDcrActions,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  GatewayRouteFormats,
  GatewayRouteSections,
} from 'gdc-common-utils-ts/constants/gateway-response';

type SecureRouteIdentity = Readonly<{
  section?: string;
  format?: string;
  resourceType?: string;
  action?: string;
}>;

/**
 * Returns whether the account bearer must already identify the DIDComm actor.
 * SMART token bootstrap instead relies on valid account OIDC authentication,
 * the active actor-bound DCR profile and its registered wallet keys because a
 * SMART bearer does not exist until this exchange completes.
 */
export function requiresVerifiedBearerActorBindingForSecureRoute(
  route: SecureRouteIdentity,
): boolean {
  const section = String(route.section || '').trim().toLowerCase();
  const format = String(route.format || '').trim().toLowerCase();
  const resourceType = String(route.resourceType || '').trim().toLowerCase();
  const action = String(route.action || '').trim().toLowerCase();
  const isSmartBootstrap = section === GatewayRouteSections.Identity
    && format === GatewayRouteFormats.OpenId
    && resourceType === IdentityAuthResourceTypes.Smart
    && (
      action === SmartPostDcrActions.Token
      || action === SmartPostDcrActions.TokenResponse
      || action === SmartPostDcrActions.LegacyBatchResponse
    );
  return !isSmartBootstrap;
}
