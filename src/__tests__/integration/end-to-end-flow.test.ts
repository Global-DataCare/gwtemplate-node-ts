// src/__tests__/integration/end-to-end-flow.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// This MUST be the first line to ensure deterministic key generation for the test run.
process.env.DEV_SEED = 'true';

// IMPORTANT: This mock MUST be at the top of the file, after setting the env var.
// It replaces the real config with a controlled test version.
const TEST_API_BASE_URL = 'http://localhost:3001';
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    nodeEnv: 'development',
    port: 3001,
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

import express from 'express';
import request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { CryptographyService } from '../../crypto/CryptographyService';
import { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from '../../crypto/interfaces/Cryptography.types';
import { Content } from '../../utils/content';
import { QueueAdapter } from '../../adapters/queue';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1, testTenant1Data } from '../data/end-to-end.data';
import { externalClientSignerJwk, externalClientEncrypterJwk } from '../data/external-client.data';
import { testClaimsTenant1Receptionist1 } from '../data/employee.data';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testTenant1AlternateName } from '../data/organization.data';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End API Flow (with Real Cryptography)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;
  let cryptoService: CryptographyService;
  let hostEncryptionKey: MlkemPublicJwk;
  let externalSigner: MldsaPrivateJwk;
  let externalEncrypter: MlkemPrivateJwk;
  let kmsService: IKmsService;
  let tenantManager: TenantsCacheManager;

  beforeAll(async () => {
    // Start the server, which will use the mocked config and generate deterministic keys
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    kmsService = serverInstance.kmsService!;
    tenantManager = serverInstance.tenantManager;

    // Get the public key directly from the running server's KmsService.
    // This ensures the client and server are using the exact same keys.
    const hostJwkSet = await kmsService.getHostPublicJwkSet();
    hostEncryptionKey = hostJwkSet.keys.find(key => key.kty === 'OKP') as MlkemPublicJwk;
    if (!hostEncryptionKey) {
      throw new Error('Test setup failed: Could not find host encryption key (OKP) in JWKSet.');
    }
    
    cryptoService = new CryptographyService();

    externalSigner = {
      alg: 'ML-DSA-44',
      kid: externalClientSignerJwk.kid,
      kty: 'AKP',
      pub: externalClientSignerJwk.pub,
      privBytes: Content.base64ToBytes(externalClientSignerJwk.priv),
    };
    externalEncrypter = {
      crv: 'ML-KEM-768',
      kid: externalClientEncrypterJwk.kid,
      kty: 'OKP',
      x: externalClientEncrypterJwk.x,
      dBytes: Content.base64ToBytes(externalClientEncrypterJwk.d),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll((done) => {
    if (addJobSpy) {
      addJobSpy.mockRestore();
    }
    if (queueAdapter instanceof QueueAdapterMem) {
      (queueAdapter as QueueAdapterMem).stop();
    }
    server.close(done);
  });

  it('Part 1: should accept a valid JWE/JWS to create a new organization', async () => {
    const orgCreationPayload = { ...testPayloadCreateTenant1 };

    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jwsCompactParts = await cryptoService.signDataJws(
      orgCreationPayload,
      jwsProtectedHeader,
      externalSigner.privBytes,
    );
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(
      compactJws,
      jweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey, // Using the key obtained from the server
    );
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    } else {
      await delay(200);
    }
  });

  it('Part 2: should accept a JWE/JWS to create an employee for the "acme" organization', async () => {
    const issuerDid = `did:web:provider.com:${testTenant1AlternateName}:employee:email:${testTenant1Data.member.admin1.email}`;
    const targetDid = 'did:web:provider.com';

    const employeeCreationPayload = {
      thid: `thid-employee-${testTenant1Data.member.receptionist1.uuid}`,
      iss: issuerDid,
      aud: targetDid,
      body: {
        data: [
          {
            type: 'Employee-form-v1.0',
            verb: 'POST',
            meta: { claims: testClaimsTenant1Receptionist1 },
          },
        ],
      },
    };

    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jwsCompactParts = await cryptoService.signDataJws(
      employeeCreationPayload,
      jwsProtectedHeader,
      externalSigner.privBytes,
    );
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(
      compactJws,
      jweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey, // Using the key obtained from the server
    );

    const registrationUrl = `/acme/cds-ES/v1/health-care/entity/org.schema/Employee/_batch`;

    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // This is the critical fix: wait for the async job to complete
    // before allowing the test suite to proceed to Part 2.
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    } else {
      await delay(200); // Fallback for other queue types
    }
  });
});