import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, type JSONWebKeySet } from 'jose';
import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { VerifiablePresentationMediaTypes } from 'gdc-common-utils-ts/utils/smart-authorization-profile';
import { verifyPinnedJwt } from './ClearingHouseService';

export type GaiaXComplianceTrust = Readonly<{
  endpoint: string;
  issuer: string;
  jwks: JSONWebKeySet;
  rulesVersion: string;
}>;

type JsonObject = Record<string, any>;
function typeIncludes(value: unknown, expected: string): boolean {
  return (Array.isArray(value) ? value : [value]).includes(expected);
}
function assertValidity(document: JsonObject, now: number): void {
  const from = Date.parse(document.validFrom);
  const until = Date.parse(document.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from > now * 1000 || until <= now * 1000 || until <= from) {
    throw new Error('GXDCH credential is outside its validity period.');
  }
}
/** The authoritative GXDCH engine performs schema/rule validation; this client verifies its exact signed result and credential coverage. */
export class GaiaXComplianceService {
  constructor(private readonly options: {
    resolveTrust: (tenantDid: string) => GaiaXComplianceTrust | Promise<GaiaXComplianceTrust>;
    resolveTenantKeys: (tenantDid: string, tenantVaultId?: string) => JSONWebKeySet | Promise<JSONWebKeySet>;
    cryptography?: ICryptography;
    now?: () => number;
    allowLocalTestEndpoint?: boolean;
  }) {}

  async verifyPresentation(input: { tenantDid: string; tenantVaultId?: string; vpToken: string }): Promise<{ credentialJwt: string; credential: JsonObject }> {
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    const vpHeader = decodeProtectedHeader(input.vpToken);
    if (vpHeader.typ !== 'vp+jwt') throw new Error('GXDCH requires a signed VP-JWT.');
    const payload = await verifyPinnedJwt(input.vpToken, await this.options.resolveTenantKeys(input.tenantDid, input.tenantVaultId), input.tenantDid, now, {
      cryptography: this.options.cryptography, requireJwtTimes: false,
    });
    const vp = (payload.vp || payload) as JsonObject;
    if (!typeIncludes(vp.type || vp['@type'], 'VerifiablePresentation') || !Array.isArray(vp.verifiableCredential) || vp.verifiableCredential.length === 0) {
      throw new Error('GXDCH presentation must contain credentials.');
    }
    if (payload.exp === undefined) assertValidity(vp, now);
    const expected = new Map<string, string>();
    for (const item of vp.verifiableCredential) {
      let credential: JsonObject = item;
      if (typeof item === 'string') credential = decodeJwt(item) as JsonObject;
      else if (typeIncludes(item?.type, 'EnvelopedVerifiableCredential')) {
        if (!String(item.id || '').startsWith('data:application/vc+jwt,')) throw new Error('Unsupported enveloped credential media type.');
        credential = decodeJwt(item.id.slice('data:application/vc+jwt,'.length)) as JsonObject;
      }
      if (credential.vc) credential = credential.vc;
      const id = credential.id || credential['@id'];
      if (typeof id !== 'string' || !id || expected.has(id)) throw new Error('GXDCH input credential identifiers must be present and unique.');
      expected.set(id, `sha256-${createHash('sha256').update(canonicalize(credential)!).digest('hex')}`);
    }
    const trust = await this.options.resolveTrust(input.tenantDid);
    const endpoint = new URL(trust.endpoint);
    const localTest = this.options.allowLocalTestEndpoint && process.env.NODE_ENV === 'test' && endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((!localTest && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.hash || !trust.rulesVersion) {
      throw new Error('GXDCH requires an HTTPS endpoint and an explicit rules version.');
    }
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': VerifiablePresentationMediaTypes.Jwt, accept: 'application/vc+jwt' }, body: input.vpToken });
    if (!response.ok) throw new Error(`GXDCH validation rejected the presentation (${response.status}).`);
    const compact = (await response.text()).trim();
    if (compact.length > 1_048_576 || compact.split('.').length !== 3 || !response.headers.get('content-type')?.split(';')[0].includes('application/vc+jwt')) {
      throw new Error('GXDCH must return a signed VC-JWT credential.');
    }
    const header = decodeProtectedHeader(compact);
    if (!['vc+jwt', 'vc+ld+json+jwt'].includes(String(header.typ))) throw new Error('Unexpected GXDCH credential JOSE type.');
    const verified = await verifyPinnedJwt(compact, trust.jwks, trust.issuer, now, { cryptography: this.options.cryptography, requireJwtTimes: false });
    const credential = (verified.vc || verified) as JsonObject;
    const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
    if (issuer !== trust.issuer || !typeIncludes(credential.type, 'gx:LabelCredential') || !credential.id) throw new Error('Unexpected GXDCH credential issuer or type.');
    assertValidity(credential, now);
    const subject = credential.credentialSubject;
    if (!subject || subject['gx:labelLevel'] !== 'SC' || subject['gx:rulesVersion'] !== trust.rulesVersion) throw new Error('GXDCH label or rules version does not match the configured profile.');
    const coverage = subject['gx:compliantCredentials'];
    if (!Array.isArray(coverage) || coverage.length !== expected.size) throw new Error('GXDCH result does not cover the submitted credentials.');
    const covered = new Set<string>();
    for (const item of coverage) {
      const id = item.id || item['@id'];
      if (covered.has(id) || expected.get(id) !== (item.digestSRI || item['gx:digestSRI'])) throw new Error('GXDCH credential digest or identifier mismatch.');
      covered.add(id);
    }
    return { credentialJwt: compact, credential };
  }
}
