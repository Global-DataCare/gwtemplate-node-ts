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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End API Flow (Legacy / Unencrypted)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Start the server, which will use the mocked config.
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
});
