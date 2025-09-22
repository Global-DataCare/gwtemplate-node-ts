// src/__tests__/integration/end-to-end-flow.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { startServer } from '../../server';
import { CryptographyService } from '../../crypto/CryptographyService';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from '../../crypto/interfaces/Cryptography.types';
import { Content } from '../../utils/content';
import { IServerConfig } from '../../config';
import { setupIntegrationTest } from './setup';
import { QueueAdapter } from '../../adapters/queue';
import { testClaimsTenant1Registration } from '../data/organization.data';
import { externalClientSignerJwk, externalClientEncrypterJwk } from '../data/external-client.data';
import { Server } from 'http';

// Mock the queue adapter, as we are not testing the worker/queue itself.
jest.mock('../../adapters/queue');
// Create a manual mock object that conforms to the QueueAdapter interface.
// This is simpler and more robust than using jest.mock() for this integration test.
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};

// Set environment variables BEFORE any other imports to ensure the config module
// reads them correctly.
process.env.NODE_ENV = 'development';
process.env.DEV_SEED = 'true';

describe('End-to-End API Flow (with Real Cryptography)', () => {
  let app: express.Express;
  let server: Server;
  let kmsService: IKmsService;
  let cryptoService: CryptographyService;
  let hostEncryptionKey: MlkemPublicJwk;
  let testConfig: IServerConfig;
  
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
    // This will read the test environment config and bootstrap the host with the deterministic key.
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;

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

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll((done) => {
    server.close(done);
  });

  it('Part 1: should accept a valid JWE/JWS to create a new organization', async () => {
    // --- ARRANGE ---
    const orgCreationPayload = { ...testClaimsTenant1Registration };
    
    // Create the inner JWS
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jwsCompactParts = await cryptoService.signDataJws(orgCreationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;
    
    // Create the outer JWE, targeting the pre-calculated host key
    console.log(`[TEST RUN] Encrypting JWE for Host KID: ${hostEncryptionKey.kid}`);
    const jweProtectedHeader = {
      alg: 'ML-KEM-768',
      enc: 'A256GCM',
      skid: externalEncrypter.kid,
    };
    const jweObject = await cryptoService.encryptJwe(
      { jws: compactJws },
      jweProtectedHeader,
      externalEncrypter,
      [hostEncryptionKey]
    );
    const compactJwe = cryptoService.jweToCompact(jweObject);

    const jurisdiction = testConfig.host.jurisdiction!;
    const registrationUrl = `/host/cds-${jurisdiction}/v1/test/registry/org.schema/Organization/_batch`;

    // --- ACT ---
    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);
      
    // --- ASSERT ---
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    // Assert directly on our manually created mock object.
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);

  });

  it.todo('Part 2: should accept a JWE/JWS to create an employee for the "acme" organization');
});
