import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';
import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import {
  buildDeterministicIdTokenFixture,
  buildDeterministicVpTokenFixture,
  DeterministicJwtTokenVerifier,
} from '../utils/deterministic-jwt-fixtures';

function buildTestApp(options?: { appAuthManager?: any; tenantsCacheManager?: any; kmsService?: any }) {
  const app = express();
  app.use(express.json({ type: ['application/json', 'application/didcomm-plain+json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: true }));

  const queueAdapter = {
    addJob: jest.fn(),
  } as any;

  const tenantsCacheManager = options?.tenantsCacheManager || {
    getDidServiceConfig: jest.fn(),
    getTenant: jest.fn(),
    getCollectionName: jest.fn(),
  };

  const kmsService = options?.kmsService || {
    decodeRequest: jest.fn(),
    getHmacBase64Url: jest.fn(),
    unprotectConfidentialData: jest.fn(),
    getPublicVerificationKey: jest.fn(),
    createDetachedJws: jest.fn(),
  };

  const asyncResponseStore = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  } as any;

  const vaultRepository = {
    query: jest.fn(),
  } as any;

  const cryptographyService = {
    verifyDetachedJws: jest.fn(),
  } as any;

  app.use(
    createApiRouter(
      queueAdapter,
      tenantsCacheManager,
      kmsService,
      asyncResponseStore,
      vaultRepository,
      cryptographyService,
      'http://localhost:3000',
      options?.appAuthManager,
    ),
  );
  return { app, queueAdapter, tenantsCacheManager };
}

describe('SECURITY_MODE content-type gates', () => {
  const targetPath = '/host/cds-es/v1/health-care/ping/org.schema/Organization/_batch';
  const credentialPath = '/host/cds-es/v1/health-care/identity/oidc/credential';
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  it('rejects application/json in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/json')
      .send({ thid: 'thid-1' });

    expect(response.status).toBe(415);
  });

  it('accepts application/json in compat mode when JSON_LEGACY=true', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/json')
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects application/fhir+json in compat mode when FHIR_LEGACY=false', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/fhir+json')
      .send({});

    expect(response.status).toBe(415);
  });

  it('accepts didcomm-plaintext in demo mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'demo',
      DEMO_ALLOW_INSECURE_BEARER: 'true',
      JSON_LEGACY: 'false',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'false',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/didcomm-plain+json')
      .send({});

    expect(response.status).toBe(400);
  });

  it('allows host organization _activate without bearer in demo mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'demo',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'false',
      DIDCOMM_PLAIN: 'true',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post('/host/cds-es/v1/test/registry/org.schema/Organization/_activate')
      .set('Content-Type', 'application/json')
      .send({});

    // If bearer were still mandatory here, we'd get 401.
    expect(response.status).toBe(400);
  });

  it('requires bearer in strict mode when insecure bearer is disabled', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const { app } = buildTestApp();
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .send({});

    expect(response.status).toBe(401);
    expect(response.text || '').toContain('Missing or invalid Bearer token');
  });

  it('rejects invalid bearer in strict mode when validation is enforced', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => {
        throw new Error('bad token');
      }),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer invalid-token')
      .send({});

    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('invalid-token');
    expect(response.status).toBe(401);
    expect(response.text || '').toContain('Invalid Bearer token');
  });

  it('calls verifyIdToken for valid bearer in strict mode and continues request flow', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({ sub: 'test-client' })),
    };
    const { app } = buildTestApp({ appAuthManager });
    const response = await request(app)
      .post(credentialPath)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('valid-token');
    // Should fail later due to tenant setup in this test harness, not due to bearer auth.
    expect(response.status).toBe(404);
  });

  it('propagates verified bearer payload into Organization/_issue jobs in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const appAuthManager = {
      verifyBearerToken: jest.fn(async () => ({
        valid: true,
        payload: { email: 'controller@example.org', sub: 'controller-sub-001' },
      })),
    };
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_issue'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'issue-thid-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              meta: {
                claims: {
                  'org.schema.Organization.alternateName': 'acme-health',
                  'org.schema.Service.category': 'health-care',
                },
              },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/health-care/registry/org.schema/Organization/_issue')
      .set('Authorization', 'Bearer valid-token')
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(appAuthManager.verifyBearerToken).toHaveBeenCalledWith('valid-token');
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload).toEqual({
      email: 'controller@example.org',
      sub: 'controller-sub-001',
    });
  });

  it('accepts a deterministically signed id_token from one virtual BFF issuer in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const fixture = await buildDeterministicIdTokenFixture({
      seed: 'gw-security-mode-seed-001',
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      subject: 'controller-sub-001',
      email: 'controller@example.org',
      extraClaims: {
        tenant_id: 'acme-id',
      },
    });
    const tokenVerifier = new DeterministicJwtTokenVerifier({
      issuer: 'did:web:bff.demo.example',
      audience: 'gw-demo-audience',
      publicJwk: fixture.publicJwk,
    });
    const appAuthManager = new AppAuthorizationManager(
      {
        get: jest.fn(),
        put: jest.fn(),
        createNewVault: jest.fn(),
        vaultExists: jest.fn(),
        getVaultConfig: jest.fn(),
        createNewSection: jest.fn(),
        updateSection: jest.fn(),
        getAllSections: jest.fn(),
        sectionExists: jest.fn(),
        getContainersListInSection: jest.fn(),
        getContainersInSection: jest.fn(),
        getHistory: jest.fn(),
        query: jest.fn(),
        delete: jest.fn(),
        purge: jest.fn(),
      } as any,
      tokenVerifier,
      {
        getPublicVerificationKey: jest.fn(),
        init: jest.fn(),
        provisionKeys: jest.fn(),
        getPublicJwks: jest.fn(),
        getPublicEncryptionKey: jest.fn(),
        getHostPublicJwkSet: jest.fn(),
        decodeRequest: jest.fn(),
        signWithManagedKey: jest.fn(),
        signWithReconstructedKey: jest.fn(),
        encodeResponse: jest.fn(),
        createDetachedJws: jest.fn(),
        createCompactJws: jest.fn(),
        protectConfidentialData: jest.fn(),
        unprotectConfidentialData: jest.fn(),
        getHmacBase64Url: jest.fn(),
        protectAttributesNameAndValue: jest.fn(),
      } as any,
      {
        verifyJws: jest.fn(),
      } as any,
    );
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_issue'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'issue-thid-oidc-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              meta: {
                claims: {
                  'org.schema.Organization.alternateName': 'acme-health',
                  'org.schema.Service.category': 'health-care',
                },
              },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/health-care/registry/org.schema/Organization/_issue')
      .set('Authorization', `Bearer ${fixture.compactToken}`)
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload).toMatchObject({
      email: 'controller@example.org',
      tenant_id: 'acme-id',
      sub: 'controller-sub-001',
    });
  });

  it('accepts one deterministically signed controller proof bearer on host lifecycle routes in strict mode', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      DEMO_ALLOW_INSECURE_BEARER: 'false',
      JSON_LEGACY: 'true',
      FHIR_LEGACY: 'true',
      DIDCOMM_PLAIN: 'true',
    };

    const fixture = await buildDeterministicVpTokenFixture({
      seed: 'gw-security-mode-vp-seed-001',
      issuerDid: 'did:web:controller.demo.example',
      audience: 'did:web:gw.demo.example#tenant_lifecycle',
      credentials: [
        {
          credential: {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
            issuer: 'did:web:ica.demo.example',
            issuanceDate: '2040-01-01T00:00:00.000Z',
            credentialSubject: {
              id: 'did:web:controller.demo.example',
              memberOf: { taxID: 'B12345678' },
              hasOccupation: { identifier: { value: 'RESPRSN' } },
            },
          },
        },
      ],
    });

    const appAuthManager = new AppAuthorizationManager(
      {
        get: jest.fn(),
        put: jest.fn(),
        createNewVault: jest.fn(),
        vaultExists: jest.fn(),
        getVaultConfig: jest.fn(),
        createNewSection: jest.fn(),
        updateSection: jest.fn(),
        getAllSections: jest.fn(),
        sectionExists: jest.fn(),
        getContainersListInSection: jest.fn(),
        getContainersInSection: jest.fn(),
        getHistory: jest.fn(),
        query: jest.fn(),
        delete: jest.fn(),
        purge: jest.fn(),
      } as any,
      {
        verify: jest.fn(async () => ({ valid: false, error: 'not an id token' })),
      } as any,
      {
        getPublicVerificationKey: jest.fn(),
        init: jest.fn(),
        provisionKeys: jest.fn(),
        getPublicJwks: jest.fn(),
        getPublicEncryptionKey: jest.fn(),
        getHostPublicJwkSet: jest.fn(),
        decodeRequest: jest.fn(),
        signWithManagedKey: jest.fn(),
        signWithReconstructedKey: jest.fn(),
        encodeResponse: jest.fn(),
        createDetachedJws: jest.fn(),
        createCompactJws: jest.fn(),
        protectConfidentialData: jest.fn(),
        unprotectConfidentialData: jest.fn(),
        getHmacBase64Url: jest.fn(),
        protectAttributesNameAndValue: jest.fn(),
      } as any,
      {
        verifyJws: jest.fn(),
      } as any,
    );
    const tenantsCacheManager = {
      getDidServiceConfig: jest.fn(async () => [{
        id: '#registry:org.schema',
        selector: { section: 'registry', format: 'org.schema' },
        serviceEndpoint: 'organization',
        actions: ['_disable'],
      }]),
      getTenant: jest.fn(),
      getCollectionName: jest.fn(),
    };
    const kmsService = {
      decodeRequest: jest.fn(async () => ({
        content: {
          thid: 'disable-thid-001',
          iss: 'did:web:portal.example.org',
          meta: {
            jwe: { header: { jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } } },
          },
          body: {
            data: [{
              meta: {
                claims: {
                  'org.schema.Organization.identifier.value': 'B12345678',
                },
              },
            }],
          },
        },
      })),
      getHmacBase64Url: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getPublicVerificationKey: jest.fn(),
      createDetachedJws: jest.fn(),
    };
    const { app, queueAdapter } = buildTestApp({ appAuthManager, tenantsCacheManager, kmsService });
    const response = await request(app)
      .post('/host/cds-es/v1/test/registry/org.schema/Organization/_disable')
      .set('Authorization', `Bearer ${fixture.compactToken}`)
      .type('form')
      .send({ request: 'opaque-jwe' });

    expect(response.status).toBe(202);
    expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
    const queuedJob = queueAdapter.addJob.mock.calls[0][1];
    expect(queuedJob.content.meta.bearer.jwt.payload.iss).toBe('did:web:controller.demo.example');
    expect(queuedJob.content.meta.bearer.jwt.payload.vp).toBeDefined();
  });
});
