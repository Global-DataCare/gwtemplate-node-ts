// Flow contract: outside explicit local demo, SMART client authentication requires an active DCR registration and its pinned key; an embedded key never grants registration or authority, and a receipt must bind the exact VP.
import { buildDeterministicSignedJwt } from '../../utils/deterministic-jwt-fixtures';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';

describe('SMART client authentication security', () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.SECURITY_MODE = 'compat'; process.env.NETWORK_MODE = 'test'; process.env.NODE_ENV = 'test'; });
  afterEach(() => { process.env = { ...saved }; });
  const issuer = 'did:web:provider.example';
  const client = 'did:web:provider.example:device:professional';
  async function fixture(status?: string, overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const token = await buildDeterministicSignedJwt({ seed: client, purpose: 'registered-smart-client', includePublicJwkInHeader: true,
      payload: { iss: client, sub: client, aud: issuer, iat: now, exp: now + 60, jti: 'client-assertion', ...overrides } });
    const repository = { get: jest.fn().mockResolvedValue(status === undefined ? undefined : { status, content: {} }) };
    const profile = { clientId: client, jwks: { keys: [token.publicJwk] } };
    const manager = new OpenIdAuthManager({ unprotectConfidentialData: async () => profile } as any, {} as any, repository as any, {} as any);
    const input = { clientId: client, tenantVaultId: 'health-care.provider', issuerDid: issuer,
      body: { client_id: client, client_assertion_type: 'private_key_jwt', client_assertion: token.compactToken } };
    return { manager, input, profile };
  }
  it('rejects an unregistered self-signed client', async () => {
    const f = await fixture(); await expect((f.manager as any).validateClientAssertion(f.input)).rejects.toThrow(/regist|active/i);
  });
  it.each(['revoked', 'disabled', ''])('rejects registration status %j', async status => {
    const f = await fixture(status); await expect((f.manager as any).validateClientAssertion(f.input)).rejects.toThrow(/regist|active/i);
  });
  it('rejects missing client identity', async () => {
    const f = await fixture('active'); await expect((f.manager as any).validateClientAssertion({ ...f.input, clientId: undefined })).rejects.toThrow(/client/i);
  });
  it('accepts a current signature pinned to the active registration', async () => {
    const f = await fixture('active'); await expect((f.manager as any).validateClientAssertion(f.input)).resolves.toMatchObject(f.profile);
  });
  it.each([
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { iat: Math.floor(Date.now() / 1000) + 600 },
    { jti: undefined },
    { aud: 'https://attacker.example/identity/openid/smart/token' },
  ])('rejects invalid assertion validity or target %j', async overrides => {
    const f = await fixture('active', overrides); await expect((f.manager as any).validateClientAssertion(f.input)).rejects.toThrow();
  });
  it('rejects an assertion replay', async () => {
    const f = await fixture('active'); await (f.manager as any).validateClientAssertion(f.input);
    await expect((f.manager as any).validateClientAssertion(f.input)).rejects.toThrow(/replay/i);
  });
  it('rejects a Clearing House receipt for a different presentation', async () => {
    const manager = new OpenIdAuthManager({} as any, {} as any, {} as any, { verifyVpToken: async () => ({ acr: 'employee', ledgerVerified: true, vpHash: 'other-presentation' }) });
    await expect((manager as any).resolveAccessProof({ issuerDid: issuer, vpToken: 'original-presentation', acrValues: ['employee'] })).rejects.toThrow();
  });
});
