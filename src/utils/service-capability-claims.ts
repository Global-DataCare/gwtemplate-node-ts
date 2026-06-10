import { ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { parseServiceCapabilityTokens } from 'gdc-common-utils-ts/constants/service-capabilities';

export const SERVICE_ADDITIONAL_TYPE_CLAIM = 'org.schema.Service.additionalType' as const;

function readNonEmptyClaim(source: Record<string, unknown> | undefined, claimName: string): string | undefined {
  const value = source?.[claimName];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function mergeServiceCapabilityClaims(...values: unknown[]): string | undefined {
  const merged = Array.from(new Set(
    values.flatMap((value) => parseServiceCapabilityTokens(value)),
  ));
  return merged.length ? merged.join(',') : undefined;
}

export function getServiceCapabilityClaimFromClaims(
  claims: Record<string, unknown> | undefined,
): string | undefined {
  return mergeServiceCapabilityClaims(
    readNonEmptyClaim(claims, ClaimsServiceSchemaorg.serviceType),
    readNonEmptyClaim(claims, SERVICE_ADDITIONAL_TYPE_CLAIM),
  );
}

export function getTenantServiceCapabilityClaim(tenantConfig: any): string | undefined {
  return mergeServiceCapabilityClaims(
    tenantConfig?.claims?.[ClaimsServiceSchemaorg.serviceType],
    tenantConfig?.claims?.[SERVICE_ADDITIONAL_TYPE_CLAIM],
    tenantConfig?.provider?.service?.[ClaimsServiceSchemaorg.serviceType],
    tenantConfig?.provider?.service?.[SERVICE_ADDITIONAL_TYPE_CLAIM],
  );
}
