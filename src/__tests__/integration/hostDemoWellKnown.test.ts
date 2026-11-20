// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/integration/hostDemoWellKnown.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { createHash } from 'node:crypto';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EXAMPLE_SIGNED_TERMS_PDF_URL } from 'gdc-common-utils-ts/examples/shared';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';
import { ORGANIZATION_REGISTRATION_REQUEST } from '../data/example-payloads';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';

import { invokeExpress } from './helpers/invokeExpress';
import { startServer, resetServerConfig } from '../../server';

const HOST_DID = 'did:web:localhost%3A3000';
const HOST_WELL_KNOWN_PREFIX = '/host/cds-EU/v1/test/.well-known';

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
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    const previousTermsUrl = process.env.HOST_TERMS_URL;
    const previousTermsHash = process.env.HOST_TERMS_SHA256;
    const terms = ORGANIZATION_REGISTRATION_REQUEST.body.data[0]!.resource.meta.claims[ClaimsServiceSchemaorg.termsOfService];
    const termsHash = createHash('sha256').update(Buffer.from(terms.split(',')[1]!, 'base64')).digest('hex');
    process.env.HOST_TERMS_URL = EXAMPLE_SIGNED_TERMS_PDF_URL;
    process.env.HOST_TERMS_SHA256 = termsHash;

    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    try {
      process.env.HOST_COVERAGE_SCOPE = 'EU';
      process.env.NETWORK_MODE = 'test';

      const rootDid = await invokeExpress(app, { method: HttpRequestMethods.Get, url: '/.well-known/did.json' });
      expect(rootDid.status).toBe(200);
      expect(JSON.parse(rootDid.text).id).toBe(HOST_DID);

      const selfDesc = await invokeExpress(app, { method: HttpRequestMethods.Get, url: `${HOST_WELL_KNOWN_PREFIX}/self-description.json` });
      expect(selfDesc.status).toBe(200);
      const selfDescJson = JSON.parse(selfDesc.text);
      expect(selfDescJson.issuer).toBe(HOST_DID);

      const legalParticipant = await invokeExpress(app, { method: HttpRequestMethods.Get, url: `${HOST_WELL_KNOWN_PREFIX}/legal-participant.vc.json` });
      expect(legalParticipant.status).toBe(200);
      const legalParticipantJson = JSON.parse(legalParticipant.text);
      expect(legalParticipantJson.issuer).toBe(HOST_DID);

      const jwks = await invokeExpress(app, { method: HttpRequestMethods.Get, url: `${HOST_WELL_KNOWN_PREFIX}/jwks.json` });
      expect(jwks.status).toBe(200);
      const jwksJson = JSON.parse(jwks.text);
      expect(jwksJson.keys.find((key: any) => key.alg === 'ES384')).toBeDefined();

      const offerPath = `${HOST_WELL_KNOWN_PREFIX}/service-offering-hosting.json`;
      const offer = await invokeExpress(app, { method: HttpRequestMethods.Get, url: offerPath });
      expect(offer.status).toBe(200);
      const offerUrl = new URL(offerPath, 'http://localhost:3000').href;
      const compact = JSON.parse(offer.text).proof.id.split(',')[1];
      const header = Content.base64UrlSafeToJSON(compact.split('.')[0]);
      const verificationKey = jwksJson.keys.find((key: { kid: string }) => key.kid === header.kid);
      const cryptography = new CryptographyService(new AdapterCryptoSdkNode());
      expect(await cryptography.verifyJws(compact, verificationKey)).toBe(true);
      expect(Content.base64UrlSafeToJSON(compact.split('.')[1])).toMatchObject({
        id: offerUrl,
        issuer: HOST_DID,
        credentialSubject: {
          type: 'gx:ServiceOffering',
          'gx:serviceOfferingTermsAndConditions': [{ 'gx:url': EXAMPLE_SIGNED_TERMS_PDF_URL, 'gx:hash': termsHash }],
        },
      });

      const catalogPath = HOST_WELL_KNOWN_PREFIX.replace('/.well-known', '/dsp/catalog/dcat.json');
      const catalog = await invokeExpress(app, {
        method: HttpRequestMethods.Get, url: catalogPath, headers: { host: 'localhost:3000' },
      });
      expect(catalog.status).toBe(200);
      expect(JSON.parse(catalog.text)['dcat:service']).toContainEqual(expect.objectContaining({
        '@id': offerUrl,
        'dcterms:publisher': { '@id': HOST_DID },
      }));

      const openidIssuer = await invokeExpress(app, { method: HttpRequestMethods.Get, url: `${HOST_WELL_KNOWN_PREFIX}/openid-credential-issuer` });
      expect(openidIssuer.status).toBe(200);
      const openidIssuerJson = JSON.parse(openidIssuer.text);
      expect(openidIssuerJson.credential_issuer).toContain('http://localhost:3000');

      const issuedVc = await invokeExpress(app, {
        method: HttpRequestMethods.Post,
        url: '/host/cds-ES/v1/health-care/identity/oidc/credential',
        headers: { authorization: 'Bearer demo', 'content-type': 'application/json' },
        body: { format: 'jwt_vc_json', type: 'gx:LegalParticipant' },
      });
      expect(issuedVc.status).toBe(200);
      const issuedVcJson = JSON.parse(issuedVc.text);
      expect(issuedVcJson.issuer).toBe(HOST_DID);
    } finally {
      queueAdapter.stop();
      if (previousTermsUrl === undefined) delete process.env.HOST_TERMS_URL;
      else process.env.HOST_TERMS_URL = previousTermsUrl;
      if (previousTermsHash === undefined) delete process.env.HOST_TERMS_SHA256;
      else process.env.HOST_TERMS_SHA256 = previousTermsHash;
      resetServerConfig();
    }
  });
});
