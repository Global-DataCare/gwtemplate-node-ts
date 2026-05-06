import express from 'express';
import request from 'supertest';
import { createApiRouter } from '../../routes/api';

function buildTestApp() {
  const app = express();
  app.use(express.json({ type: '*/*' }));
  app.use(express.urlencoded({ extended: true }));

  const queueAdapter = {
    addJob: jest.fn(),
  } as any;

  const tenantsCacheManager = {
    getDidServiceConfig: jest.fn(),
    getTenant: jest.fn(),
    getCollectionName: jest.fn(),
  } as any;

  const kmsService = {
    decodeRequest: jest.fn(),
    getHmacBase64Url: jest.fn(),
    unprotectConfidentialData: jest.fn(),
    getPublicVerificationKey: jest.fn(),
    createDetachedJws: jest.fn(),
  } as any;

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
    ),
  );
  return app;
}

describe('SECURITY_MODE content-type gates', () => {
  const targetPath = '/host/cds-es/v1/health-care/ping/org.schema/Organization/_batch';
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

    const app = buildTestApp();
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

    const app = buildTestApp();
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

    const app = buildTestApp();
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

    const app = buildTestApp();
    const response = await request(app)
      .post(targetPath)
      .set('Content-Type', 'application/didcomm-plaintext+json')
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

    const app = buildTestApp();
    const response = await request(app)
      .post('/host/cds-es/v1/test/registry/org.schema/Organization/_activate')
      .set('Content-Type', 'application/json')
      .send({});

    // If bearer were still mandatory here, we'd get 401.
    expect(response.status).toBe(400);
  });
});
