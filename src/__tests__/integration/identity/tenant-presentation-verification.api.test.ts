// Flow contract: a backend assertion authenticates the tenant presentation verifier; an anonymous request is rejected and a successful result retains its original signed JWT.
import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { invokeExpress } from '../helpers/invokeExpress';

describe('tenant presentation verifier API', () => {
  it('requires backend authentication and returns the signed verification receipt', async () => {
    const manager = { verify: jest.fn().mockResolvedValue('original.signed.receipt') };
    const app = express(); app.use(express.json());
    app.use((createApiRouter as any)({}, {}, {}, {}, {}, {}, 'https://verifier.example', undefined, undefined, undefined, undefined, undefined, manager));
    const url = '/hospital/cds-ES/v1/health-care/identity/openid/presentation/_verify';
    const denied = await invokeExpress(app, { method: 'POST', url, headers: { 'content-type': 'application/json' }, body: {} });
    expect(denied.status).toBe(401); expect(manager.verify).not.toHaveBeenCalled();
    const accepted = await invokeExpress(app, { method: 'POST', url,
      headers: { 'content-type': 'application/json', authorization: 'Bearer backend.signed.assertion' }, body: { vp_token: 'professional.presentation.jwt' } });
    expect(accepted.status).toBe(200); expect(accepted.text).toBe('original.signed.receipt');
    expect(manager.verify).toHaveBeenCalledWith(expect.objectContaining({ requestUrl: `https://verifier.example${url}`, assertion: 'backend.signed.assertion' }));
  });
});
