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
import * as request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { QueueAdapter } from '../../adapters/queue';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { IAuthorizationManager } from '../../managers/auth/IAuthorizationManager';
import { testCommunicationAppointmentFhirR4 } from '../data/appointment.data';
import { BundleEntry } from '../../models/bundle';
import { IAccessTokenClaims } from '../../models/auth';

// Mock implementation for the AuthorizationManager
class MockAuthorizationManager implements IAuthorizationManager {
  public consentStore: Map<string, boolean> = new Map();

  // Helper to set up consent for a test
  public setConsent(consentId: string, hasConsent: boolean): void {
    this.consentStore.set(consentId, hasConsent);
  }

  // In the real implementation, this method would inspect the resource to find the consentId.
  // For the mock, we pass the consentId directly for simplicity.
  public async canAccess(
    _claims: IAccessTokenClaims,
    resource: BundleEntry,
    _action: string,
    consentId?: string,
  ): Promise<boolean> {
    if (!consentId) {
      return false;
    }
    return this.consentStore.get(consentId) ?? false;
  }
}


const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End API Flow (Legacy / Unencrypted)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;
  let authManager: MockAuthorizationManager;

  beforeAll(async () => {
    // Create the mock authorization manager for testing purposes
    authManager = new MockAuthorizationManager();

    // Create a mock authentication middleware
    const mockAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

    // Start the server, passing the mock middleware and mock auth manager
    const serverInstance = await startServer({
      testMiddlewares: [mockAuthMiddleware],
      authManager: authManager,
    });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll(async () => {
    if (addJobSpy) {
      addJobSpy.mockRestore();
    }
    if (queueAdapter instanceof QueueAdapterMem) {
      (queueAdapter as QueueAdapterMem).stop();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });

  it('Part 1 (Legacy): should accept an unencrypted JSON request to create a new organization', async () => {
    // This test simulates a client that does not use JWE/JWS encryption.
    // The payload is sent as a standard JSON body.
    // Trust is established solely via a Bearer token in the Authorization header.
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer mock-valid-token')
      .send(orgCreationPayload);

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    } else {
      await delay(200);
    }
  });

  describe('FHIR Communication Flow', () => {
    const communicationUrl = '/v1/health-care/individual/org.hl7.fhir.r4/Communication';
    const accessToken = 'Bearer mock-valid-token-for-fhir';

    // To mock the canAccess method correctly, we need to bypass its complex parameters
    // in the test and just control its return value based on the consentId.
    let canAccessSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the real canAccess method of our *mocked* manager
      canAccessSpy = jest.spyOn(authManager, 'canAccess');
    });

    afterEach(() => {
      canAccessSpy.mockRestore();
    });

    it('should REJECT a FHIR Communication with 403 Forbidden if consent is NOT present', async () => {
      // 1. ARRANGE
      const consentId = 'urn:uuid:consent-not-granted';
      const communicationPayload = {
        ...testCommunicationAppointmentFhirR4,
        partOf: [{ reference: consentId }],
      };

      // We configure the mock implementation to return false for this consentId.
      authManager.setConsent(consentId, false);
      // We also need to mock the spy's behavior for this specific test.
      canAccessSpy.mockImplementation((_c, _r, _a, passedConsentId) =>
        Promise.resolve(authManager.consentStore.get(passedConsentId) ?? false),
      );

      // 2. ACT
      const response = await request
        .default(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(communicationPayload);

      // 3. ASSERT
      expect(response.status).toBe(403);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe('forbidden');
      // Verify that the auth manager was actually called with the correct consentId
      expect(canAccessSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'create', consentId);
    });

    it('should REJECT a FHIR Communication with 400 Bad Request if partOf is missing', async () => {
      // 1. ARRANGE
      const communicationPayload = { ...testCommunicationAppointmentFhirR4 };
      delete (communicationPayload as any).partOf;

      // 2. ACT
      const response = await request
        .default(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(communicationPayload);

      // 3. ASSERT
      expect(response.status).toBe(400);
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].code).toBe('required');
    });

    it('should ACCEPT a FHIR Communication with 202 Accepted if consent IS present', async () => {
      // 1. ARRANGE
      const consentId = 'urn:uuid:consent-granted-for-comm';
      const communicationPayload = {
        ...testCommunicationAppointmentFhirR4,
        partOf: [{ reference: consentId }],
      };
      authManager.setConsent(consentId, true);
      canAccessSpy.mockImplementation((_c, _r, _a, passedConsentId) =>
        Promise.resolve(authManager.consentStore.get(passedConsentId) ?? false),
      );

      // 2. ACT
      const response = await request
        .default(app)
        .post(communicationUrl)
        .set('Content-Type', 'application/fhir+json')
        .set('Authorization', accessToken)
        .send(communicationPayload);

      // 3. ASSERT
      expect(response.status).toBe(202);
      expect(response.headers.location).toBeDefined();
      expect(addJobSpy).toHaveBeenCalledTimes(1);
      expect(canAccessSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'create', consentId);

      // Ensure the job is processed before the test finishes to avoid open handles.
      if (queueAdapter instanceof QueueAdapterMem) {
        await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
      }
    });
  });
});

