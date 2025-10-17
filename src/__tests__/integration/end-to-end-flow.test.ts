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

import * as express from 'express';
import * as request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { CryptographyService } from '../../crypto/CryptographyService';
import { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from '../../crypto/interfaces/Cryptography.types';
import { Content } from '../../utils/content';
import { QueueAdapter } from '../../adapters/queue';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1, testTenant1Data } from '../data/end-to-end.data';
import { externalClientSignerJwk, externalClientEncrypterJwk } from '../data/external-client.data';
import { testClaimsTenant1Receptionist1, testTenant1Receptionist1DidExternal, testTenant1Receptionist1Urn } from '../data/employee.data';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testTenant1AlternateName, testTenant1AddressCountry } from '../data/organization.data';
import { testIndividualOnboardingBatchEntries } from '../data/customer-onboarding.data';
import { IPayloadResponse } from '../../models/response';
import { ClaimsPersonSchemaorg } from '../../models/schemaorg';
import { generateUrnHash } from '../../utils/urn-hash';
import { normalizePhoneNumber } from '../../utils/phone-number';
import { BlockchainAdapterMem } from '../../adapters/BlockchainAdapterMem';


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
  let createdPersonId: string; // Variable to store the ID of the created person
  let blockchainAdapter: BlockchainAdapterMem;


  beforeAll(async () => {
    // Start the server, which will use the mocked config and generate deterministic keys
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    kmsService = serverInstance.kmsService!;
    tenantManager = serverInstance.tenantManager;
    blockchainAdapter = serverInstance.blockchainAdapter as BlockchainAdapterMem;


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

    const response = await request.default(app)
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
      thid: `thid-test-employee-receptionist1`,
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

    const response = await request.default(app)
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

  it('Part 3: should create a new customer (individual) and allow polling for the result', async () => {
    // 1. ARRANGE: Define URLs, DIDs, and the request payload
    const tenantId = testTenant1AlternateName; // acme
    // The 'acme' tenant was created in 'ES' jurisdiction in Part 1. We must be consistent.
    const jurisdiction = 'es'; 
    // TODO: function for external url and did:web or hosted url and did:web is required instead of URN for the target audience
    const targetDid = await tenantManager.getTenantDid('health-care_acme');
    const issuerDid = testTenant1Receptionist1DidExternal;
    const thid = `thid-e2e-person-onboarding-${Date.now()}`;

    const personCreationPayload = {
      thid: thid,
      iss: issuerDid,
      aud: targetDid,
      body: {
        data: testIndividualOnboardingBatchEntries,
      },
    };

    // 2. ACT (Phase 1): Sign and encrypt the payload, then POST it
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jwsCompactParts = await cryptoService.signDataJws(personCreationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = { enc: 'A256GCM', cty: 'JWS', skid: externalEncrypter.kid };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/health-care/individual/org.schema/Person/_batch`;
    
    const postResponse = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    // 3. ASSERT (Phase 1): Check for 202 Accepted and Location header
    expect(postResponse.status).toBe(202);
    expect(postResponse.headers.location).toBeDefined();
    const pollingUrl = postResponse.headers.location;
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 4. ACT (Phase 2): Wait for the job to process and then poll for the result
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    } else {
      await delay(200);
    }
    
    const pollResponse = await request.default(app)
      .post(pollingUrl) // Use POST for secure polling to keep thid out of logs
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ thid: thid });

    // 5. ASSERT (Phase 2): Check for 200 OK and decrypt the final response
    expect(pollResponse.status).toBe(200);
    const encryptedFinalResponse = pollResponse.text;
    
    // To simulate the external client decrypting the response, we use the cryptoService 
    // with the client's private key and the server's public key (embedded in the JWE).
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IPayloadResponse;

    // 6. ASSERT (Phase 3): Verify the content of the final, decrypted response
    expect(finalResponse.thid).toBe(thid);
    expect(finalResponse.body.type).toBe('batch-response');
    const responseEntry = finalResponse.body.data[0];
    expect(responseEntry.response.status).toBe('201');
    expect(responseEntry.resource.id).toBeDefined();
    expect(responseEntry.resource.resourceType).toBe('Person');

    // Store the created person's ID for the next test
    createdPersonId = responseEntry.resource.id;
  });

  it('Part 4: should add a consent entry to the Person\'s Composition', async () => {
    // TDD ROADMAP: This test defines the next feature to be implemented.
    expect(createdPersonId).toBeDefined(); // Ensure Part 3 ran and we have a person to update

    const compositionPayload = {
      thid: `thid-e2e-composition-${Date.now()}`,
      iss: testTenant1Receptionist1DidExternal,
      aud: await tenantManager.getTenantDid('health-care_acme'),
      body: {
        data: [
          {
            type: 'Composition-entry-add-v1.0',
            meta: {
              claims: {
                'org.schema.Composition.subject': `urn:uuid:${createdPersonId}`,
                'org.schema.Composition.event': [{ // Add a reference to a document
                  'org.schema.CreativeWork.identifier': 'urn:uuid:document-id-123',
                  'org.schema.CreativeWork.type': 'ConsentForm',
                }]
              }
            }
          }
        ]
      }
    };
    
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jws = await cryptoService.signDataJws(compositionPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = { enc: 'A256GCM', cty: 'JWS', skid: externalEncrypter.kid };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Composition/_batch`;
    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    expect(response.status).toBe(202); // We only test submission for now
  });

  it('Part 5: should send a Communication with an appointment to the Person', async () => {
    // TDD ROADMAP: This test defines the appointment notification feature.
    expect(createdPersonId).toBeDefined();

    const icsContent = `BEGIN:VCALENDAR...END:VCALENDAR`;
    const icsBase64 = Content.stringToStdBase64(icsContent);
    const appointmentThid = `thid-e2e-communication-${Date.now()}`;

    const communicationPayload = {
      thid: appointmentThid,
      iss: testTenant1Receptionist1DidExternal,
      aud: await tenantManager.getTenantDid('health-care_acme'),
      body: {
        data: [
          {
            type: 'Communication-send-v1.0',
            meta: {
              claims: { // This structure should align with the FHIR-to-DIDComm mapping
                'org.schema.Communication.recipient': `urn:uuid:${createdPersonId}`,
                'org.schema.Communication.payload': [
                  { '@type': 'Text', 'org.schema.Text.text': 'Your appointment details.' },
                  {
                    '@type': 'Attachment',
                    'org.schema.CreativeWork.contentType': 'text/calendar',
                    'org.schema.CreativeWork.contentData': icsBase64,
                    'org.schema.CreativeWork.title': 'appointment.ics'
                  }
                ]
              }
            }
          }
        ]
      }
    };
    
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jws = await cryptoService.signDataJws(communicationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = { enc: 'A256GCM', cty: 'JWS', skid: externalEncrypter.kid };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Communication/_batch`;
    const response = await request.default(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    expect(response.status).toBe(202);
  });

  it('Part 6: should allow the Person to send a response to the appointment Communication', async () => {
    // TDD ROADMAP: This tests the patient's ability to reply.
    expect(createdPersonId).toBeDefined();
    // This test would require swapping the signer/encrypter keys to simulate the patient's client.
    // For now, we just define the intent.

    const responsePayload = {
      pthid: '...original-appointment-thid...', // pthid links to the original message
      thid: `thid-e2e-response-${Date.now()}`,
      iss: `did:web:patient-app-instance-123`, // The patient's app instance DID
      aud: await tenantManager.getTenantDid('health-care_acme'),
      body: {
        data: [{
          type: 'Communication-response-v1.0',
          meta: { claims: { 'org.schema.Text.text': 'Confirmed' } }
        }]
      }
    };
    
    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Communication/_batch`;
    // const response = await ... POST the response ...
    // expect(response.status).toBe(202);
  });

  it('Part 7: should allow the EMR to create a Subscription for appointment updates', async () => {
    // TDD ROADMAP: This tests the subscription mechanism.
    expect(createdPersonId).toBeDefined();

    const subscriptionPayload = {
      thid: `thid-e2e-subscription-${Date.now()}`,
      iss: testTenant1Receptionist1DidExternal,
      aud: await tenantManager.getTenantDid('health-care_acme'),
      body: {
        data: [{
          type: 'Subscription-create-v1.0',
          meta: {
            claims: {
              'org.schema.Subscription.subject': `urn:uuid:${createdPersonId}`,
              'org.schema.Subscription.event': 'appointment-update',
              'org.schema.Subscription.endpoint': 'https://emr.acme.com/webhook/123'
            }
          }
        }]
      }
    };
    
    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Subscription/_batch`;
    // const response = await ... POST the subscription ...
    // expect(response.status).toBe(202);
  });

  it('Part 8: should successfully discover a Person DID via the asynchronous discovery endpoint', async () => {
    // 1. ARRANGE: Seed the mock blockchain with the expected hash and DID
    const targetDid = `did:web:api.acme.org:individual:multibase:${createdPersonId}`;
    const discoveryClaimType = 'JHNES-CL';
    const discoveryClaimValue = '987654321';
    
    // Manually replicate the URN generation logic from the manager to get the correct hash
    const expectedUrn = `urn:antifraud:eu:identifier:${discoveryClaimType}:${discoveryClaimValue}`;
    const expectedHash = generateUrnHash(expectedUrn);
    blockchainAdapter.addMapping(expectedHash, targetDid);
    
    // 2. ARRANGE: Construct the discovery request payload
    const thid = `thid-e2e-discovery-${Date.now()}`;
    const discoveryPayload = {
        thid: thid,
        iss: testTenant1Receptionist1DidExternal,
        aud: await tenantManager.getTenantDid('health-care_acme'),
        body: {
            data: [{
                type: 'Person-discover-v1.0',
                meta: {
                    claims: {
                        [ClaimsPersonSchemaorg.identifierType]: discoveryClaimType,
                        [ClaimsPersonSchemaorg.identifierValue]: discoveryClaimValue,
                    }
                }
            }]
        }
    };

    // 3. ACT (Phase 1): Encrypt and POST the discovery job
    const jwsProtectedHeader = { alg: externalSigner.alg, kid: externalSigner.kid };
    const jws = await cryptoService.signDataJws(discoveryPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = { enc: 'A256GCM', cty: 'JWS', skid: externalEncrypter.kid };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const discoveryUrl = `/acme/cds-es/v1/health-care/test-network/org.schema/Person/_discovery`;
    
    const postResponse = await request.default(app)
      .post(discoveryUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`request=${compactJwe}`);

    // 4. ASSERT (Phase 1): Check for 202 Accepted
    expect(postResponse.status).toBe(202);
    expect(postResponse.headers.location).toBeDefined();
    const pollingUrl = postResponse.headers.location;

    // 5. ACT (Phase 2): Wait and poll for the result
    if (queueAdapter instanceof QueueAdapterMem) {
        await (queueAdapter as QueueAdapterMem).waitForEmptyQueue();
    } else {
        await delay(200);
    }
    
    const pollResponse = await request.default(app)
      .post(pollingUrl)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ thid: thid });
      
    // 6. ASSERT (Phase 2): Decrypt and verify the final response
    expect(pollResponse.status).toBe(200);
    const encryptedFinalResponse = pollResponse.text.replace('response=', '');
    
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IPayloadResponse;
    
    const responseEntry = finalResponse.body.data[0];
    expect(responseEntry.response.status).toBe('200');
    expect(responseEntry.response.location).toBe(targetDid);
  });
});
