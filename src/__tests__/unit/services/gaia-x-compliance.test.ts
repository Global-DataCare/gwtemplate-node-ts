// Flow contract: send the tenant-signed VP using the GXDCH VC-API media types; accept only a pinned issuer's signed SC label for the configured rules version and exact credential digests; reject invalid, expired, substituted or incomplete results.
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { verifyPinnedJwt } from '../../../services/ClearingHouseService';
import { GaiaXComplianceService } from '../../../services/GaiaXComplianceService';
import { createGaiaXLegalParticipantCredential } from '../../../utils/credential-generators';
import { buildDeterministicSignedJwt } from '../../utils/deterministic-jwt-fixtures';
import { EXAMPLE_CONTROLLER_DID, EXAMPLE_PROVIDER_ORGANIZATION_DID, EXAMPLE_ORGANIZATION_LEGAL_NAME, EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, EXAMPLE_SYNTHETIC_CERT_COUNTRY } from 'gdc-common-utils-ts/examples/shared';

describe('GXDCH standard-compliance VC-API', () => {
  const now = Math.floor(Date.now() / 1000);
  const credential = createGaiaXLegalParticipantCredential({ did: EXAMPLE_CONTROLLER_DID, issuerDid: EXAMPLE_CONTROLLER_DID, officialName: EXAMPLE_ORGANIZATION_LEGAL_NAME, vatId: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, countryCode: EXAMPLE_SYNTHETIC_CERT_COUNTRY, webDomain: 'https://provider.example' });
  const digest = `sha256-${createHash('sha256').update(canonicalize(credential)!).digest('hex')}`;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => { fetchMock = jest.spyOn(globalThis, 'fetch'); });
  afterEach(() => fetchMock.mockRestore());
  async function fixture(subjectOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
    const vp = await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'gxdch-tenant-vp', header: { typ: 'vp+jwt', cty: 'vp' }, payload: { iss: EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 120, jti: 'gxdch-vp', type: ['VerifiablePresentation'], verifiableCredential: [credential] } });
    const result = await buildDeterministicSignedJwt({ seed: EXAMPLE_PROVIDER_ORGANIZATION_DID, purpose: 'gxdch-label', header: { typ: 'vc+jwt', cty: 'vc' }, payload: {
      iss: EXAMPLE_PROVIDER_ORGANIZATION_DID, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID, id: 'https://verifier.example/credential/result', type: ['VerifiableCredential', 'gx:LabelCredential'],
      validFrom: new Date((now - 1) * 1000).toISOString(), validUntil: new Date((now + 120) * 1000).toISOString(),
      credentialSubject: { id: 'https://verifier.example/credential/result#cs', 'gx:labelLevel': 'SC', 'gx:rulesVersion': 'CD25.03', 'gx:compliantCredentials': [{ id: credential.id, digestSRI: digest }], ...subjectOverrides }, ...overrides,
    } });
    fetchMock.mockResolvedValue(new Response(result.compactToken, { status: 201, headers: { 'content-type': 'application/vc+jwt' } }));
    const service = new GaiaXComplianceService({ now: () => now, resolveTrust: async () => ({ endpoint: 'https://verifier.example/api/credential-offers/standard-compliance', issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID, jwks: { keys: [result.publicJwk] }, rulesVersion: 'CD25.03' }), resolveTenantKeys: async () => ({ keys: [vp.publicJwk] }) });
    return { service, vp: vp.compactToken, result: result.compactToken, resultKey: result.publicJwk };
  }
  it('returns the exact verified GXDCH credential without replacing the issuer signature', async () => {
    const f = await fixture(); expect((await f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).credentialJwt).toBe(f.result);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: f.vp, headers: { 'content-type': 'application/vp+jwt', accept: 'application/vc+jwt' } }));
  });
  it.each([EXAMPLE_PROVIDER_ORGANIZATION_DID, { id: EXAMPLE_PROVIDER_ORGANIZATION_DID }])('accepts a VC-JOSE issuer without duplicating it as iss: %p', async issuer => {
    const f = await fixture({}, { iss: undefined, issuer });
    expect((await f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).credentialJwt).toBe(f.result);
  });
  it('does not accept the VC issuer object as a bearer JWT issuer', async () => {
    const f = await fixture({}, { iss: undefined, issuer: { id: EXAMPLE_PROVIDER_ORGANIZATION_DID } });
    await expect(verifyPinnedJwt(f.result, { keys: [f.resultKey] }, EXAMPLE_PROVIDER_ORGANIZATION_DID, now)).rejects.toThrow(/issuer/i);
  });
  it('rejects a VC issuer object outside the pinned trust configuration', async () => {
    const f = await fixture({}, { iss: undefined, issuer: { id: EXAMPLE_CONTROLLER_DID } });
    await expect(f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).rejects.toThrow(/issuer/i);
  });
  it.each([
    ['wrong rules', { 'gx:rulesVersion': 'other-rules' }],
    ['wrong label', { 'gx:labelLevel': 'other-label' }],
    ['missing coverage', { 'gx:compliantCredentials': [] }],
    ['substituted bytes', { 'gx:compliantCredentials': [{ id: credential.id, digestSRI: 'sha256-' + '0'.repeat(64) }] }],
  ])('rejects %s', async (_name, overrides) => { const f = await fixture(overrides); await expect(f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).rejects.toThrow(); });
  it('rejects an expired compliance credential', async () => {
    const f = await fixture({}, { validUntil: new Date((now - 60) * 1000).toISOString() }); await expect(f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).rejects.toThrow(/valid|expir/i);
  });
  it('rejects another tenant before sending the presentation', async () => {
    const f = await fixture(); await expect(f.service.verifyPresentation({ tenantDid: EXAMPLE_PROVIDER_ORGANIZATION_DID, vpToken: f.vp })).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects an unsigned JSON success response', async () => {
    const f = await fixture(); fetchMock.mockResolvedValue(new Response('{}')); await expect(f.service.verifyPresentation({ tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: f.vp })).rejects.toThrow();
  });
});
