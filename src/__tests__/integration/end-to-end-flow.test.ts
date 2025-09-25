// src/__tests__/integration/end-to-end-flow.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// Note: to check open port 3000 in macOS run "lsof -i :3000" and then kill the process (kill -9 PID)
// IMPORTANT: This file contains two critical setup steps that must occur in order.

// --- 1. SET RUNTIME ENVIRONMENT VARIABLES ---
// The `DEV_SEED` variable is read at RUNTIME by the KmsService to determine
// if it should generate deterministic keys. We set it here using `process.env`
// so it's available when the service's methods are called during the test.
process.env.DEV_SEED = 'true';

import express from 'express';
import request from 'supertest';
import { IServerConfig } from '../../config';
import { setupIntegrationTest } from './setup';
import { Server } from 'http';
import { createHash } from 'crypto';
import { startServer } from '../../server';
import { CryptographyService } from '../../crypto/CryptographyService';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from '../../crypto/interfaces/Cryptography.types';
import { Content } from '../../utils/content';
import { QueueAdapter } from '../../adapters/queue';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1 } from '../data/organization.data';
import { externalClientSignerJwk, externalClientEncrypterJwk } from '../data/external-client.data';

// --- 2. MOCK CONFIGURATION AT LOAD TIME ---
// The `NODE_ENV` variable is read only ONCE when the `config.ts` module is
// first imported. By that time, it's too late to change it with `process.env`.
// Therefore, we must use `jest.mock()` to intercept the import and provide a
// modified configuration object that forces `nodeEnv: 'development'`. This ensures
// the server starts up with the real `KmsService` instead of the `DemoKmsService`.
// We use `jest.requireActual` inside the mock to get the original config first.
jest.mock('../../config', () => {
  const originalConfig = jest.requireActual('../../config').config;
  return {
    config: {
      ...originalConfig,
      nodeEnv: 'development',
    },
  };
});

// NOTE: We are NOT mocking the queue adapter. This is a true integration test,
// so we will use the real in-memory implementation and spy on its methods.

describe('End-to-End API Flow (with Real Cryptography)', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;
  let kmsService: IKmsService;
  let cryptoService: CryptographyService;
  let hostEncryptionKey: MlkemPublicJwk;
  let testConfig: Partial<IServerConfig>; // The setup function returns a Partial config.
  
  // These will hold the keys in the format needed by the crypto functions (with byte arrays)
  let externalSigner: MldsaPrivateJwk;
  let externalEncrypter: MlkemPrivateJwk;

  beforeAll(async () => {
    // --- 1. SET UP THE TEST ENVIRONMENT ---
    // Environment variables are now set at the top of the file.
    testConfig = setupIntegrationTest();
    
    // --- 2. PRE-CALCULATE DETERMINISTIC HOST KEY ---
    // Because DEV_SEED=true, KmsService will generate the host's keys from a seed
    // derived from the string 'host'. We can replicate that logic here to know
    // in advance what the host's public key and KID will be.
    cryptoService = new CryptographyService();
    const hostKemSeed = createHash('sha512').update('host-kem').digest().subarray(0, 64);
    const hostKeyPair = await cryptoService.generateKeyPairMlKem(hostKemSeed);
    hostEncryptionKey = hostKeyPair.publicJWKey;
    console.log(`[TEST SETUP] Host Encryption Key KID pre-calculated: ${hostEncryptionKey.kid}`);

    // --- 3. START THE REAL SERVER ---
    // This will return the running app, the server instance, and the *real* queue adapter.
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;

    // --- 4. CONVERT EXTERNAL KEYS ---
    externalSigner = {
      alg: "ML-DSA-44",
      kid: externalClientSignerJwk.kid,
      kty: "AKP",
      pub: externalClientSignerJwk.pub,
      privBytes: Content.base64ToBytes(externalClientSignerJwk.priv),
    };
    externalEncrypter = {
      crv: "ML-KEM-768",
      kid: externalClientEncrypterJwk.kid,
      kty: "OKP",
      x: externalClientEncrypterJwk.x,
      dBytes: Content.base64ToBytes(externalClientEncrypterJwk.d),
    };
  });

  beforeEach(() => {
    // Before each test, we spy on the 'addJob' method of the REAL queue adapter instance.
    // We clear any previous spies to ensure a clean slate.
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll((done) => {
    // It's important to restore the original method after all tests are done.
    addJobSpy.mockRestore();
    // Stop the queue processor to allow Jest to exit gracefully.
    if (queueAdapter instanceof QueueAdapterMem) {
      (queueAdapter as QueueAdapterMem).stop();
    }
    server.close(done);
  });

  it('Part 1: should accept a valid JWE/JWS to create a new organization', async () => {
    // --- ARRANGE ---
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    
    // Create the inner JWS
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jwsCompactParts = await cryptoService.signDataJws(orgCreationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;
    
    // Create the outer JWE, targeting the pre-calculated host key
    console.log(`[TEST RUN Encrypting JWE for Host KID: ${hostEncryptionKey.kid}`);
    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS', // Per JOSE spec, content type should be 'JWS' for nested JWS
      skid: externalEncrypter.kid,
    };

    const compactJwe = await cryptoService.encryptJweToCompact(
      compactJws, // The payload is the compact JWS string directly
      jweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey
    );

    const jurisdiction = testConfig.host?.jurisdiction!;
    const registrationUrl = `/host/cds-${jurisdiction}/v1/test/registry/org.schema/Organization/_batch`;

    // --- ACT ---
    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);
      
    // --- ASSERT ---
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    // Assert that our spy on the real adapter's method was called.
    expect(addJobSpy).toHaveBeenCalledTimes(1);
  });

  it.todo('Part 2: should accept a JWE/JWS to create an employee for the "acme" organization');
});