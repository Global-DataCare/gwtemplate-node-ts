// Flow contract: authenticate an explicitly trusted tenant backend, bind its signed assertion to the exact request and endpoint, reject replay, then return the original authorization context with a tenant-signed current-state result.
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import { buildDeterministicSignedJwt } from '../../utils/deterministic-jwt-fixtures';
import { TenantPresentationVerificationManager } from '../../../managers/TenantPresentationVerificationManager';
import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';

describe('authenticated tenant presentation verifier', () => {
  const now = Math.floor(Date.now() / 1000);
  const requester = 'did:web:requester.example';
  const recipient = 'did:web:verifier.example';
  const url = 'https://verifier.example/hospital/cds-ES/v1/health-care/identity/openid/presentation/_verify';
  const body = { nonce: 'verification-request-nonce', tenant_did: requester, vp_token: 'original.professional.presentation', acr_values: ['employee'], token_scope: 'original-scope' };
  async function fixture(overrides: Record<string, unknown> = {}) {
    const assertion = await buildDeterministicSignedJwt({ seed: requester, purpose: 'backend-verifier-request', payload: {
      iss: requester, sub: requester, aud: url, iat: now, exp: now + 60, jti: 'request-1',
      request_hash: createHash('sha256').update(canonicalize(body)!).digest('hex'), ...overrides,
    } });
    const verifier = { verifyVpToken: jest.fn().mockResolvedValue({ acr: 'employee', amr: ['vc'], vpHash: createHash('sha256').update(body.vp_token).digest('hex'), ledgerVerified: true }) };
    let operational = true;
    const manager = new TenantPresentationVerificationManager({
      tenants: { tenantExists: async () => true, isTenantOperational: async () => operational, getDidDocument: async () => ({ id: recipient }) } as any,
      verifier, replay: new ReplayProtectionStoreMem(), now: () => now,
      resolveRequester: async (tenant, caller) => {
        if (tenant !== recipient || caller !== requester) throw new Error('Requester is not trusted.');
        return { jwks: { keys: [assertion.publicJwk] }, capabilities: ['verifier'] };
      },
      signResult: async (_vault, payload) => (await buildDeterministicSignedJwt({ seed: recipient, purpose: 'backend-verifier-result', payload })).compactToken,
    });
    return { manager, verifier, disable: () => { operational = false; }, input: { tenantId: 'hospital', sector: 'health-care', requestUrl: url, assertion: assertion.compactToken, body } };
  }
  it('authenticates and binds the caller before performing current-state verification', async () => {
    const f = await fixture();
    const payload = decodeJwt(await f.manager.verify(f.input));
    expect(payload).toMatchObject({ iss: recipient, aud: requester, ledger_verified: true, token_scope: body.token_scope });
    expect(f.verifier.verifyVpToken).toHaveBeenCalledWith(expect.objectContaining({ tenantDid: recipient, vpToken: body.vp_token }));
  });
  it('rejects a disabled tenant before any presentation verification', async () => { const f = await fixture(); f.disable(); await expect(f.manager.verify(f.input)).rejects.toThrow(/active|disabled/i); expect(f.verifier.verifyVpToken).not.toHaveBeenCalled(); });
  it('rejects a replay before running the verifier again', async () => {
    const f = await fixture(); await f.manager.verify(f.input);
    await expect(f.manager.verify(f.input)).rejects.toThrow(/replay/i);
    expect(f.verifier.verifyVpToken).toHaveBeenCalledTimes(1);
  });
  it.each([{ aud: 'https://other.example' }, { exp: now - 1 }, { sub: recipient }, { request_hash: 'tampered' }])('rejects invalid backend evidence %j', async overrides => {
    const f = await fixture(overrides); await expect(f.manager.verify(f.input)).rejects.toThrow();
    expect(f.verifier.verifyVpToken).not.toHaveBeenCalled();
  });
  it('rejects a body changed after signing', async () => {
    const f = await fixture(); await expect(f.manager.verify({ ...f.input, body: { ...body, token_scope: 'broader' } })).rejects.toThrow(/hash|request/i);
    expect(f.verifier.verifyVpToken).not.toHaveBeenCalled();
  });
  it('does not sign a positive result when current-state verification is denied', async () => {
    const f = await fixture(); f.verifier.verifyVpToken.mockRejectedValue(new Error('Credential revoked.'));
    await expect(f.manager.verify(f.input)).rejects.toThrow(/revoked/i);
  });
});
