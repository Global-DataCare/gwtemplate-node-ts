import { createHash } from 'node:crypto';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantVaultId } from '../utils/tenant';

export type LegacyPublicTenantReader = (scope: Readonly<{
  tenantId: string; sector: string; jurisdiction: string; version: string;
}>) => Promise<Readonly<{ did: object; credential?: object }> | undefined>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hasPrivateKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPrivateKey);
  if (!isObject(value)) return false;
  if (typeof value.kty === 'string' && ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(key => Object.hasOwn(value, key))) {
    return true;
  }
  return Object.entries(value).some(([key, child]) => key.startsWith('privateKey') || hasPrivateKey(child));
}

/** Reads the original public artifacts of explicitly pinned legacy registrations. */
export function createLegacyPublicTenantReader(
  vault: Pick<IVaultRepository, 'get'>,
  collection: string,
  pinConfiguration: string,
): LegacyPublicTenantReader {
  const configured: unknown = JSON.parse(pinConfiguration);
  if (!isObject(configured) || !Object.entries(configured).every(([id, hash]) =>
    id !== 'host' && typeof hash === 'string' && /^[0-9a-f]{64}$/u.test(hash))) {
    throw new Error('Invalid legacy public tenant fingerprint map.');
  }
  const pins = new Map(Object.entries(configured));
  const section = getEnvSectionId('tenants');

  return async ({ tenantId, sector, jurisdiction, version }) => {
    if (tenantId === 'host' || version !== 'v1') return;
    const vaultId = getTenantVaultId(sector, tenantId);
    const expected = pins.get(vaultId);
    if (!expected) return;
    const doc = await vault.get<ConfidentialStorageDoc>(collection, vaultId, section);
    const jwe = doc?.jwe;
    if (doc?.id !== vaultId || doc.status !== 'active' || jwe?.tag !== '_tag_' || jwe?.iv !== '_iv_'
      || typeof jwe.ciphertext !== 'string' || createHash('sha256').update(jwe.ciphertext).digest('hex') !== expected) return;
    let stored: unknown;
    try {
      stored = JSON.parse(Buffer.from(jwe.ciphertext, 'base64url').toString('utf8'));
    } catch {
      return;
    }
    if (!isObject(stored) || !isObject(stored.claims)
      || stored.claims[ClaimsOrganizationSchemaorg.alternateName] !== tenantId
      || stored.claims[ClaimsServiceSchemaorg.category] !== sector
      || String(stored.claims[ClaimsOrganizationSchemaorg.addressCountry]).toUpperCase() !== jurisdiction.toUpperCase()) return;

    const did = stored.didDocument;
    if (!isObject(did) || typeof did.id !== 'string' || !did.id.startsWith('did:web:') || hasPrivateKey(did)) return;
    const credential = stored.governanceVc;
    const subjects = isObject(credential)
      ? (Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject])
      : [];
    const signedCredential = isObject(credential) && credential.proof && !hasPrivateKey(credential)
      && subjects.some(subject => isObject(subject) && (subject.id ?? subject['@id']) === did.id)
      ? credential : undefined;
    return { did, credential: signedCredential };
  };
}
