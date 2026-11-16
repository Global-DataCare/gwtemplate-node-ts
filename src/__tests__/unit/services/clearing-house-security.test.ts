// Flow contract: select only the home tenant or an explicitly trusted verifier; require a signed, fresh, presentation-bound positive result; absent or negative evidence must deny access and production must never use simulation.
import { createHash } from 'node:crypto';
import { ClearingHouseService } from '../../../services/ClearingHouseService';
import { buildDeterministicSignedJwt } from '../../utils/deterministic-jwt-fixtures';
import { EXAMPLE_CONTROLLER_DID, EXAMPLE_SUBJECT_DID } from 'gdc-common-utils-ts/examples/shared';

describe('Clearing House security contract', () => {
  const savedEnv = { ...process.env };
  const request = { tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: 'signed.professional.presentation', acrValues: ['urn:antifraud:acr:openid4vp:employee'] };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: EXAMPLE_CONTROLLER_DID, aud: EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 60, jti: 'clearing-house-result', acr: request.acrValues[0], amr: ['openid4vp', 'vc'], vp_hash: createHash('sha256').update(request.vpToken).digest('hex'), ledger_verified: true };
  let fetchMock: jest.SpyInstance;
  let lastReceipt: string;
  beforeEach(() => { process.env.CLEARING_HOUSE_MODE = 'remote'; fetchMock = jest.spyOn(globalThis, 'fetch'); });
  afterEach(() => { fetchMock.mockRestore(); process.env = { ...savedEnv }; });
  async function service(overrides: Record<string, unknown> = {}, trustOverrides: Record<string, unknown> = {}) {
    const signed = await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'clearing-house-response', payload: { ...payload, ...overrides } });
    fetchMock.mockImplementation(async (_url: unknown, init: { body: string }) => {
      const wire = JSON.parse(init.body);
      lastReceipt = (await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'clearing-house-response', payload: { ...payload, nonce: wire.nonce, ...overrides } })).compactToken;
      return new Response(lastReceipt, { headers: { 'content-type': 'application/jwt' } });
    });
    const trust = { homeTenantReference: EXAMPLE_CONTROLLER_DID, sourceTenant: { tenantReference: EXAMPLE_CONTROLLER_DID, endpoint: 'https://verifier.example/verify', capabilities: ['verifier'] }, trustedFederatedTenantReferences: [], issuer: EXAMPLE_CONTROLLER_DID, audience: EXAMPLE_CONTROLLER_DID, jwks: { keys: [signed.publicJwk] }, ...trustOverrides };
    return new (ClearingHouseService as any)({ resolveTrust: async () => trust, now: () => now, signClientAssertion: async ({ audience, requestHash }: any) => (await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'clearing-house-client', payload: { iss: EXAMPLE_CONTROLLER_DID, aud: audience, iat: now, exp: now + 60, jti: 'clearing-house-client', request_hash: requestHash } })).compactToken });
  }
  it('uses the demo verifier only after selecting the explicit local demo profile', async () => { delete process.env.CLEARING_HOUSE_MODE; process.env.SECURITY_MODE = 'demo'; process.env.NETWORK_MODE = 'test'; process.env.NODE_ENV = 'test'; delete process.env.DEPLOYMENT_ENV; expect(await new ClearingHouseService().verifyVpToken(request)).toMatchObject({ ledgerVerified: true, vpHash: payload.vp_hash }); });
  it('rejects an HTTP success with an empty body', async () => {
    const verifier = await service(); fetchMock.mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(verifier.verifyVpToken(request)).rejects.toThrow(/signed|JWT|signature/i);
  });
  it('accepts an authentic positive result from the trusted tenant', async () => {
    const verifier = await service(); expect(await verifier.verifyVpToken(request)).toMatchObject({ ledgerVerified: true, vpHash: payload.vp_hash, acr: payload.acr });
  });
  it('rejects reuse of a previously positive receipt for a new verification request', async () => { const verifier = await service(); await verifier.verifyVpToken(request); fetchMock.mockResolvedValue(new Response(lastReceipt, { headers: { 'content-type': 'application/jwt' } })); await expect(verifier.verifyVpToken(request)).rejects.toThrow(/nonce|request/i); });
  it('authenticates the backend request instead of exposing an anonymous verification oracle', async () => {
    const verifier = await service();
    await verifier.verifyVpToken(request);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: expect.objectContaining({ authorization: expect.stringMatching(/^Bearer /) }) }));
  });
  it.each([
    ['missing ledger decision', { ledger_verified: undefined }],
    ['negative ledger decision', { ledger_verified: false }],
    ['different presentation', { vp_hash: '0'.repeat(64) }],
    ['different audience', { aud: EXAMPLE_SUBJECT_DID }],
    ['expired result', { exp: now - 1 }],
    ['missing expiry', { exp: undefined }],
    ['different assurance', { acr: 'unexpected-assurance' }],
  ])('rejects %s', async (_label, overrides) => {
    const verifier = await service(overrides as Record<string, unknown>); await expect(verifier.verifyVpToken(request)).rejects.toThrow();
  });
  it('rejects a verifier tenant without explicit federation trust before making HTTP requests', async () => {
    const verifier = await service({}, { sourceTenant: { tenantReference: EXAMPLE_SUBJECT_DID, endpoint: 'https://verifier.example/verify', capabilities: ['verifier'] } });
    await expect(verifier.verifyVpToken(request)).rejects.toThrow(/trust/i); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['test', 'demo', 'staging', 'production'])('rejects simulation in %s even when explicitly selected', async environment => {
    process.env.CLEARING_HOUSE_MODE = 'stub'; process.env.NODE_ENV = environment; process.env.NETWORK_MODE = 'test-network'; process.env.SECURITY_MODE = 'demo';
    await expect(new ClearingHouseService().verifyVpToken(request)).rejects.toThrow(/simulation|stub|not configured|unsupported/i);
  });
});
