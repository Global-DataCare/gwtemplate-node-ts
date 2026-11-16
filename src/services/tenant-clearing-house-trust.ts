import type { JSONWebKeySet } from 'jose';

/** Server-owned trust. Browser input never selects a verifier or its keys. */
export type TenantClearingHouseTrust = Readonly<{
  homeTenantReference: string;
  sourceTenant: Readonly<{ tenantReference: string; endpoint: string; capabilities: readonly string[] }>;
  trustedFederatedTenantReferences: readonly string[];
  issuer: string;
  audience: string;
  jwks: JSONWebKeySet;
}>;

export function assertTenantClearingHouseTrust(trust: TenantClearingHouseTrust, tenantDid: string, allowLocalTestEndpoint = false): URL {
  if (!trust || !tenantDid || trust.homeTenantReference !== tenantDid || trust.audience !== tenantDid) {
    throw new Error('Clearing House trust must belong to the requesting tenant.');
  }
  const source = trust.sourceTenant;
  if (!source?.capabilities.includes('verifier') || trust.issuer !== source.tenantReference) {
    throw new Error('Clearing House source must advertise the trusted verifier capability.');
  }
  if (source.tenantReference !== tenantDid && !trust.trustedFederatedTenantReferences?.includes(source.tenantReference)) {
    throw new Error('Clearing House source tenant is not explicitly trusted.');
  }
  const url = new URL(source.endpoint);
  const localTest = allowLocalTestEndpoint && process.env.NODE_ENV === 'test' && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localTest && url.protocol !== 'https:') || url.username || url.password || url.hash) {
    throw new Error('Clearing House endpoint must be an absolute HTTPS URL without credentials or fragment.');
  }
  if (!Array.isArray(trust.jwks?.keys) || trust.jwks.keys.length === 0) throw new Error('Clearing House requires server-pinned verification keys.');
  return url;
}

export function resolveConfiguredClearingHouseTrust(tenantDid: string): TenantClearingHouseTrust {
  const entries = JSON.parse(process.env.CLEARING_HOUSE_TENANTS_JSON || '{}');
  const trust = Object.prototype.hasOwnProperty.call(entries, tenantDid) ? entries[tenantDid] : undefined;
  if (!trust) throw new Error('No Clearing House trust configured for this tenant.');
  return trust;
}
