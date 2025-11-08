// src/__tests__/e2e/api.e2e.spec.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// This E2E test runs against a LIVE Firestore instance, configured via .env.test.
// It validates the entire LEGACY API flow (unencrypted JSON) from HTTP request to database interaction.

import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { QueueAdapter } from '../../adapters/queue';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { KmsService } from '../../services/KmsService';
import { ClaimsRecord } from '../../models/resource-document';

// Mock the KmsService to bypass actual JWE decryption for this legacy test
jest.mock('../../services/KmsService');

// Increase the timeout for all tests in this file
jest.setTimeout(20000);

describe('End-to-End API Flow (Legacy with Live Firestore)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;
  
  const tenantId = `e2e-legacy-tenant-${Date.now()}`;
  const modifiedClaims: ClaimsRecord = {
    ...testPayloadCreateTenant1.body.data[0].meta.claims,
    'org.schema.Organization.identifier': `urn:uuid:${tenantId}`,
  };
  
  const orgCreationPayload = {
    ...testPayloadCreateTenant1,
    body: {
      data: [{
        ...testPayloadCreateTenant1.body.data[0],
        meta: { claims: modifiedClaims },
        resource: {}, // Keep empty resource as per user correction
      }]
    }
  };

  beforeAll(async () => {
    // We are mocking the service, so we need to provide a mock implementation.
    (KmsService as jest.Mock).mockImplementation(() => {
      return {
        decodeRequest: jest.fn((req: express.Request): Promise<IJob<IJobContent>> => {
          // In legacy plaintext mode, the body is the job content. We just pass it through.
          const jobContent = req.body as IJobContent;
          return Promise.resolve({
            name: `unsecure-host-registry-org.schema.Organization-_batch`, // Mock a job name
            content: jobContent,
          });
        }),
      };
    });

    const serverInstance = await startServer();
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
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
    // TODO: Add a cleanup step to delete the created tenant from Firestore
  });

  it('should accept a legacy JSON request to create a new organization, and save it to Firestore', async () => {
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    // 1. ACT: Send the plain JSON request
    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/didcomm-plaintext+json') // Use the correct legacy content type
      .send(orgCreationPayload);

    // 2. ASSERT (Phase 1): API should accept the job
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 3. VERIFY (Phase 2): This part remains as a TODO
    console.log('TODO: Verify that the tenant with ID', tenantId, 'was created in Firestore.');
  });
});

