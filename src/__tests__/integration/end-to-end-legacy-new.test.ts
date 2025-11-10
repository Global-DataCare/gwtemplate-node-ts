// src/__tests__/integration/end-to-end-legacy.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// IMPORTANT: Mock MUST be at the top, replacing the real config with a controlled test version.
const TEST_API_BASE_URL = 'http://localhost:3002';
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    nodeEnv: 'development',
    port: 3002,
    apiHostname: 'localhost',
    hostExternalDomain: 'localhost',
    apiBaseUrl: TEST_API_BASE_URL,
    sectorsAllowed: ['health-care', 'test'],
    dbProvider: 'mem',
    storageProvider: 'mem', // Ensure in-memory storage is used for this integration test
    queueProvider: 'mem',
    kekSecret: 'test-kek-secret-dd-key-256-bits',
    host: {
      legalName: 'Gateway Test Host',
      jurisdiction: 'ES',
      idType: 'vat',
      idValue: 'B12345678',
      adminEmail: 'admin@host.com',
      adminUid: 'host-admin-uid',
    },
    mongo: { dbName: 'test-db' },
    firebase: {},
  })),
}));

import * as express from 'express';
import request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { QueueAdapter } from '../../adapters/queue';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { IAuthorizationManager } from '../../managers/auth/IAuthorizationManager';
import { testCommunicationAppointmentFhirR4 } from '../data/appointment.data';
import { BundleEntry } from '../../models/bundle';
import { IAccessTokenClaims } from '../../models/auth';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { ClaimsServiceSchemaorg } from '../../models/schemaorg';
import { getTenantVaultId } from '../../utils/tenant';
import { IncludedResource } from '../../models/jsonapi';

// Mock implementation for the AuthorizationManager
class MockAuthorizationManager implements IAuthorizationManager {
  public consentStore: Map<string, boolean> = new Map();

  authorize(req: express.Request, res: express.Response, next: express.NextFunction): void {
    // This mock is permissive for non-FHIR tests.
    // For FHIR-specific tests, the mockAuthMiddleware below injects claims.
    next();
  }

  public setConsent(consentId: string, hasConsent: boolean): void {
    this.consentStore.set(consentId, hasConsent);
  }

  public async canAccess(
    _claims: IAccessTokenClaims,
    _resource: BundleEntry,
    _action: string,
    consentId?: string,
  ): Promise<boolean> {
    if (!consentId) return false;
    return this.consentStore.get(consentId) ?? false;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End API Flow (Legacy / Unencrypted)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let vaultRepository: IVaultRepository;
  let tenantManager: TenantsCacheManager;
  let authManager: MockAuthorizationManager;
  let addJobSpy: jest.SpyInstance;

  beforeAll(async () => {
    authManager = new MockAuthorizationManager();
    // This mock middleware now also simulates the router extracting the tenantId from the URL for routing.
    const mockRoutingMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const urlParts = req.originalUrl.split('/');
      if (urlParts.length > 1 && urlParts[1] === 'host') {
        (req as any).tenantId = 'host';
      }
      
      if (req.headers.authorization === 'Bearer mock-valid-token-for-fhir') {
        (req as any).claims = {
          iss: 'did:web:test-issuer.com',
          sub: 'did:web:test-employee.com',
          aud: 'did:web:this-gateway.com',
          scope: 'fhir:Communication.create',
          client_id: 'test-client',
        } as IAccessTokenClaims;
      }
      next();
    };

    const serverInstance = await startServer({
      testMiddlewares: [mockRoutingMiddleware],
      authManager: authManager,
    });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    vaultRepository = serverInstance.vaultRepository;
    tenantManager = serverInstance.tenantManager;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll(async () => {
    if (addJobSpy) addJobSpy.mockRestore();
    if (queueAdapter instanceof QueueAdapterMem) (queueAdapter as QueueAdapterMem).stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  it('Part 1 (Legacy): should accept an unencrypted JSON request to create a new organization', async () => {
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .send(orgCreationPayload);

    expect(response.status).toBe(202);
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    if (queueAdapter instanceof QueueAdapterMem) await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
  });

  it('Part 2 (PDF Attachment): should process organization with Base64 PDF and store a URL', async () => {
    const pdfBase64 = Buffer.from('dummy-pdf-content').toString('base64');
    const orgCreationPayloadWithPdf = JSON.parse(JSON.stringify(testPayloadCreateTenant1));
    const claims = orgCreationPayloadWithPdf.body.data[0].meta.claims;
    claims[ClaimsServiceSchemaorg.termsOfService] = pdfBase64;
    claims['org.schema.Organization.alternateName'] = 'acme-with-pdf';
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .send(orgCreationPayloadWithPdf);

    expect(response.status).toBe(202);
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    if (queueAdapter instanceof QueueAdapterMem) await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();

    const vaultId = getTenantVaultId(claims[ClaimsServiceSchemaorg.category], claims['org.schema.Organization.alternateName']);
    const collectionName = tenantManager.getCollectionName(vaultId);
    expect(collectionName).toBeDefined();

    const services = await vaultRepository.getContainersInSection<IncludedResource>(collectionName!, 'services');
    const persistedService = services[0];
    const termsUrl = persistedService.meta.claims[ClaimsServiceSchemaorg.termsOfService];
    const termsHash = persistedService.meta.claims[`${ClaimsServiceSchemaorg.termsOfService}#hash`];
    
    expect(termsUrl).not.toBe(pdfBase64);
    expect(termsUrl).toContain('/local-storage/');
    expect(termsHash).toBeDefined();
  });

  describe('FHIR Communication Flow', () => {
    const communicationUrl = '/v1/health-care/individual/org.hl7.fhir.r4/Communication';
    const accessToken = 'Bearer mock-valid-token-for-fhir';
    let canAccessSpy: jest.SpyInstance;

    beforeEach(() => {
      canAccessSpy = jest.spyOn(authManager, 'canAccess');
    });

    afterEach(() => {
      canAccessSpy.mockRestore();
    });

    it('should REJECT a FHIR Communication with 403 Forbidden if consent is NOT present', async () => {
      const consentId = 'urn:uuid:consent-not-granted';
      const communicationPayload = { ...testCommunicationAppointmentFhirR4, partOf: [{ reference: consentId }] };
      authManager.setConsent(consentId, false);

          const response = await request(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(communicationPayload);

      expect(response.status).toBe(403);
      expect(canAccessSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'create', consentId);
    });

    it('should REJECT a FHIR Communication with 400 Bad Request if partOf is missing', async () => {
      const { partOf, ...payload } = testCommunicationAppointmentFhirR4 as any;
      const response = await request(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(payload);

      expect(response.status).toBe(400);
    });

    it('should ACCEPT a FHIR Communication with 202 Accepted if consent IS present', async () => {
      const consentId = 'urn:uuid:consent-granted-for-comm';
      const communicationPayload = { ...testCommunicationAppointmentFhirR4, partOf: [{ reference: consentId }] };
      authManager.setConsent(consentId, true);

          const response = await request(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(communicationPayload);

      expect(response.status).toBe(202);
      expect(canAccessSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'create', consentId);

      if (queueAdapter instanceof QueueAdapterMem) await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    });
  });
});
