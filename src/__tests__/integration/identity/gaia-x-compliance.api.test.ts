// Flow contract: the tenant's authenticated client submits a VP for its own configured GXDCH; the route preserves the signed result and cannot select a provider from browser input.
import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { invokeExpress } from '../helpers/invokeExpress';

describe('tenant GXDCH compliance API', () => {
  it('uses the tenant compliance manager and returns the original signed credential', async () => {
    const manager = { verify: jest.fn().mockResolvedValue({ credentialJwt: 'original.signed.credential' }) };
    const app = express(); app.use(express.urlencoded({ extended: true }));
    app.use((createApiRouter as any)({}, {}, {}, {}, {}, {}, 'https://custodian.example', undefined, undefined, undefined, undefined, manager));
    const response = await invokeExpress(app, { method: 'POST', url: '/hospital/cds-ES/v1/health-care/identity/gaia-x/standard-compliance',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'custodian.example' },
      body: { vp_token: 'signed.tenant.presentation', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: 'signed.registered.client' } });
    expect(response.status).toBe(201); expect(response.headers['content-type']).toContain('application/vc+jwt');
    expect(response.text).toBe('original.signed.credential');
    expect(manager.verify).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'hospital', jurisdiction: 'ES', sector: 'health-care', vpToken: 'signed.tenant.presentation' }));
  });
});
