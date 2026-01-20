// src/__tests__/integration/hostDemoWellKnown.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { invokeExpress } from './helpers/invokeExpress';

const HOST_DID = 'did:web:localhost%3A3000';

describe('Host well-known endpoints (demo, mem)', () => {
  it('should expose host VC artifacts and legacy key when running in demo mode', async () => {
    process.env.NODE_ENV = 'demo';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.LEGACY_SIGN_ALG = 'ES384';
    process.env.HOST_INTERNAL_IP = '0.0.0.0';
    process.env.HOST_INTERNAL_PORT = '3000';
    process.env.HOST_EXTERNAL_DOMAIN = '';

    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.ORG_HOST_TERMS_URL = 'https://example.org/terms.pdf';

    jest.resetModules();
    const { startServer } = await import('../../server');

    const { app, queueAdapter } = await startServer({ listen: false });
    try {
      const selfDesc = await invokeExpress(app, { method: 'GET', url: '/host/.well-known/self-description.json' });
      expect(selfDesc.status).toBe(200);
      const selfDescJson = JSON.parse(selfDesc.text);
      expect(selfDescJson.issuer).toBe(HOST_DID);

      const legalParticipant = await invokeExpress(app, { method: 'GET', url: '/host/.well-known/legal-participant.vc.json' });
      expect(legalParticipant.status).toBe(200);
      const legalParticipantJson = JSON.parse(legalParticipant.text);
      expect(legalParticipantJson.issuer).toBe(HOST_DID);

      const jwks = await invokeExpress(app, { method: 'GET', url: '/host/.well-known/jwks.json' });
      expect(jwks.status).toBe(200);
      const jwksJson = JSON.parse(jwks.text);
      expect(jwksJson.keys.find((key: any) => key.alg === 'ES384')).toBeDefined();

      const openidIssuer = await invokeExpress(app, { method: 'GET', url: '/host/.well-known/openid-credential-issuer' });
      expect(openidIssuer.status).toBe(200);
      const openidIssuerJson = JSON.parse(openidIssuer.text);
      expect(openidIssuerJson.credential_issuer).toContain('http://localhost:3000');

      const issuedVc = await invokeExpress(app, {
        method: 'POST',
        url: '/host/cds-ES/v1/health-care/identity/oidc/credential',
        headers: { authorization: 'Bearer demo', 'content-type': 'application/json' },
        body: { format: 'jwt_vc_json', type: 'gx:LegalParticipant' },
      });
      expect(issuedVc.status).toBe(200);
      const issuedVcJson = JSON.parse(issuedVc.text);
      expect(issuedVcJson.issuer).toBe(HOST_DID);
    } finally {
      queueAdapter.stop();
    }
  });
});
