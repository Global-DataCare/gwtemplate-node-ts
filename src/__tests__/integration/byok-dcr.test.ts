// src/__tests__/integration/end-to-end-flow.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// This MUST be the first line to ensure deterministic key generation for the test run.
process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.DB_PROVIDER = 'mem';
process.env.STORAGE_PROVIDER = 'mem';
process.env.QUEUE_PROVIDER = 'mem';
process.env.SECTORS_ALLOWED = 'health-care,test';
process.env.HOST_EXTERNAL_DOMAIN = 'provider.com';

import { jest } from '@jest/globals';
import type * as express from 'express';
import type { Server } from 'http';
import type { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { QueueAdapter } from '../../adapters/queue';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IBlockchainAdapter } from '../../adapters/IBlockchainAdapter';

// Config is derived from process.env in server.ts for this suite.
const { startServer } = await import('../../server');
const { CryptographyService } = await import('gdc-common-utils-ts/CryptographyService');
const { Content } = await import('gdc-common-utils-ts/utils/content');
const { QueueAdapterMem } = await import('../../adapters/queue-mem');
const { testPayloadCreateTenant1, testTenant1Data } = await import('../data/end-to-end.data');
const { testClaimsTenant1Receptionist1, testTenant1Receptionist1DidExternal, testTenant1Receptionist1Urn } = await import('../data/employee.data');
const { testTenant1AlternateName } = await import('../data/organization.data');
const { testIndividualOnboardingBatchEntries } = await import('../data/customer-onboarding.data');
const { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg } = await import('gdc-common-utils-ts/constants/schemaorg');
const { generateUrnHash } = await import('../../utils/urn-hash');
const { createHash } = await import('crypto');
const { BlockchainAdapterMem } = await import('../../adapters/BlockchainAdapterMem');
const { invokeExpress } = await import('./helpers/invokeExpress');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// endpoint (e.g., `.../_dcr`). 
// For now, this test validates that a tenant admin can onboard by providing their own keys
// during the initial registration, and that subsequent API calls using those keys are resolved correctly.

describe('End-to-End API Flow (BYOK Onboarding)', () => {
  let app: express.Express;
  let server: Server | undefined;
  let queueAdapter: QueueAdapter;
  let addJobSpy: ReturnType<typeof jest.spyOn>;
  let cryptoService: InstanceType<typeof CryptographyService>;
  let hostEncryptionKey: MlkemPublicJwk;
  let externalSigner: MldsaPrivateJwk;
  let externalEncrypter: MlkemPrivateJwk;
  let kmsService: IKmsService;
  let tenantManager: TenantsCacheManager;
  let createdPersonId: string; // Variable to store the ID of the created person
  let blockchainAdapter: IBlockchainAdapter;
  let vaultRepository: IVaultRepository;


  beforeAll(async () => {
    // Start the server, which will use the mocked config and generate deterministic keys
    const serverInstance = await startServer({ listen: false });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    kmsService = serverInstance.kmsService!;
    tenantManager = serverInstance.tenantManager;
    blockchainAdapter = serverInstance.blockchainAdapter;
    vaultRepository = serverInstance.vaultRepository;
    cryptoService = serverInstance.cryptographyService;


    // Get the public key directly from the running server's KmsService.
    // This ensures the client and server are using the exact same keys.
    const hostJwkSet = await kmsService.getHostPublicJwkSet();
    hostEncryptionKey = hostJwkSet.keys.find(key => key.kty === 'OKP') as MlkemPublicJwk;
    if (!hostEncryptionKey) {
      throw new Error('Test setup failed: Could not find host encryption key (OKP) in JWKSet.');
    }
    await tenantManager.loadHost();

    // Generate deterministic keys for the "external client" (the future tenant admin)
    // This makes the test reproducible without relying on static key files.
    const externalClientSeed = 'byok-test-client-seed';
    const dsaSeed = createHash('sha256').update(externalClientSeed + '-dsa').digest().subarray(0, 32);
    const kemSeed = createHash('sha512').update(externalClientSeed + '-kem').digest().subarray(0, 64);
    
    const signerKeyPair = await cryptoService.generateKeyPairMlDsa(dsaSeed);
    const encrypterKeyPair = await cryptoService.generateKeyPairMlKem(kemSeed);

    externalSigner = { ...signerKeyPair.publicJWKey, privBytes: signerKeyPair.secretKeyBytes };
    externalEncrypter = { ...encrypterKeyPair.publicJWKey, dBytes: encrypterKeyPair.secretKeyBytes };
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
      (queueAdapter as InstanceType<typeof QueueAdapterMem>).stop();
    }
    const serverToClose = server;
    if (serverToClose) {
      await new Promise<void>((resolve, reject) => {
        serverToClose.close((err: any) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    }
  });

  it('Part 1: should accept a BOOTSTRAPPING request, process it, and return a verifiable Offer', async () => {
    // This part tests the "Bring-Your-Own-Key" (BYOK) scenario.
    // During the very first "organization creation" request, the client's DID (`iss`)
    // is not yet registered in the system. To establish trust, the client MUST
    // embed their public keys (JWKs) directly into the JWS and JWE protected headers.
    // The server will then associate these keys with the new admin employee being created.
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const thid = orgCreationPayload.thid;

    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
      jwk: { // Public part of the signer key
        alg: externalSigner.alg,
        kid: externalSigner.kid,
        kty: externalSigner.kty,
        pub: externalSigner.pub,
      },
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
      jwk: { // Public part of the encrypter key
        crv: externalEncrypter.crv,
        kid: externalEncrypter.kid,
        kty: externalEncrypter.kty,
        x: externalEncrypter.x,
      },
    };
    const compactJwe = await cryptoService.encryptJweToCompact(
      compactJws,
      jweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey, // Using the key obtained from the server
    );
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    // 1. ACT (Phase 1): Post the initial job
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

    // 2. ASSERT (Phase 1): Check for 202 Accepted and polling location
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    const pollingUrl = response.headers.location;
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 3. ACT (Phase 2): Wait for job completion and poll for the result
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
    } else {
      await delay(200);
    }
    
    const pollingPath = new URL(pollingUrl).pathname;
    const pollResponse = await invokeExpress(app, {
      method: 'POST',
      url: pollingPath,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { thid },
    });

    // 4. ASSERT (Phase 2): Check for 200 OK and decrypt the final response
    expect(pollResponse.status).toBe(200);
    const encryptedFinalResponse = pollResponse.text.startsWith('response=')
      ? pollResponse.text.slice('response='.length)
      : pollResponse.text;
    
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;

    // 5. ASSERT (Phase 3): Verify the content of the final, decrypted Offer
    expect(finalResponse.thid).toBe(thid);
    const responseEntry = finalResponse.body.data[0];
    const claims = responseEntry.meta.claims;

    expect(responseEntry.type).toBe('Organization-registration-offer-v1.0');
    expect(claims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(2);
    expect(claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
    expect(claims[ClaimsOfferSchemaorg.price]).toBe('0.00'); // Or the calculated price
    expect(claims[ClaimsOfferSchemaorg.offeredBy]).toBe('did:web:provider.com');

    // --- ACT (Phase 4): Accept the Offer by submitting an Order ---
    const offerId = claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderThid = `${thid}-order`;
    const orderPayload = {
      thid: orderThid,
      iss: orgCreationPayload.iss,
      aud: orgCreationPayload.aud,
      jti: `jti-${orderThid}`,
      type: 'api+json',
      body: {
        data: [
          {
            type: 'Organization-order-request-v1.0',
            meta: { claims: { 'Order.acceptedOffer.identifier': offerId } },
          },
        ],
      },
    };

    const orderJwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
      jwk: {
        alg: externalSigner.alg,
        kid: externalSigner.kid,
        kty: externalSigner.kty,
        pub: externalSigner.pub,
      },
    };
    const orderJwsParts = await cryptoService.signDataJws(orderPayload, orderJwsProtectedHeader, externalSigner.privBytes);
    const orderCompactJws = `${orderJwsParts.protected}.${orderJwsParts.payload}.${orderJwsParts.signature}`;

    const orderJweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
      jwk: {
        crv: externalEncrypter.crv,
        kid: externalEncrypter.kid,
        kty: externalEncrypter.kty,
        x: externalEncrypter.x,
      },
    };
    const orderCompactJwe = await cryptoService.encryptJweToCompact(
      orderCompactJws,
      orderJweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey,
    );

    const orderUrl = `/host/cds-ES/v1/test/registry/org.schema/Order/_batch`;
    const orderPostResponse = await invokeExpress(app, {
      method: 'POST',
      url: orderUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: orderCompactJwe },
    });
    expect(orderPostResponse.status).toBe(202);
    expect(orderPostResponse.headers.location).toBeDefined();

    const orderPollingPath = new URL(orderPostResponse.headers.location).pathname;
    let orderPollResponse: { status: number; headers: any; text: string } | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (queueAdapter instanceof QueueAdapterMem) {
        await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
      } else {
        await delay(50);
      }
      orderPollResponse = await invokeExpress(app, {
        method: 'POST',
        url: orderPollingPath,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid: orderThid },
      });
      if (orderPollResponse.status === 200) break;
      await delay(25);
    }

    expect(orderPollResponse?.status).toBe(200);
    const encryptedOrderFinalResponse = orderPollResponse!.text.startsWith('response=')
      ? orderPollResponse!.text.slice('response='.length)
      : orderPollResponse!.text;
    const { decryptedBytes: orderDecryptedBytes } = await cryptoService.decryptJwe(encryptedOrderFinalResponse, externalEncrypter);
    const orderFinalResponse = JSON.parse(Content.bytesToStringUTF8(orderDecryptedBytes)) as IDecodedDidcommPayload;
    expect(orderFinalResponse.thid).toBe(orderThid);
    expect(orderFinalResponse.body?.data?.[0]?.response?.status).toBe('201');

    // Reload host + tenant caches after finalization to make subsequent tests deterministic.
    await tenantManager.loadHost();
    expect(await tenantManager.getTenantDid('health-care_acme')).toBeDefined();
  });

  it('Part 2: should accept a STANDARD request without embedded JWKs', async () => {
    // This part tests the standard operational flow.
    // After bootstrapping (Part 1), the client's admin employee is registered,
    // and their keys are known to the server. The client's DID (`iss`) can now be
    // resolved by the server to find the correct public keys for signature
    // verification and response encryption. Therefore, the client NO LONGER
    // needs to embed the full JWKs in every request, saving bandwidth.
    const issuerDid = `did:web:provider.com:${testTenant1AlternateName}:employee:${testTenant1Data.member.admin1.email}`;
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

    const jwsProtectedHeader = { // NO jwk here
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jwsCompactParts = await cryptoService.signDataJws(
      employeeCreationPayload,
      jwsProtectedHeader,
      externalSigner.privBytes,
    );
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = { // NO jwk here
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

    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // This is the critical fix: wait for the async job to complete
    // before allowing the test suite to proceed to Part 2.
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
    } else {
      await delay(200); // Fallback for other queue types
    }
    // CRITICAL: Reload the cache again to pick up the newly created employee's keys,
    // which were added to the tenant's DID document.
    await tenantManager.loadHost();
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
    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jwsCompactParts = await cryptoService.signDataJws(personCreationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/health-care/individual/org.schema/Person/_batch`;
    
    const postResponse = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

    // 3. ASSERT (Phase 1): Check for 202 Accepted and Location header
    expect(postResponse.status).toBe(202);
    expect(postResponse.headers.location).toBeDefined();
    const pollingUrl = postResponse.headers.location;
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 4. ACT (Phase 2): Wait for the job to process and then poll for the result
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
    } else {
      await delay(200);
    }
    
    const pollingPath = new URL(pollingUrl).pathname;
    const pollResponse = await invokeExpress(app, {
      method: 'POST',
      url: pollingPath, // Use POST for secure polling to keep thid out of logs
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { thid },
    });

    // 5. ASSERT (Phase 2): Check for 200 OK and decrypt the final response
    expect(pollResponse.status).toBe(200);
    const encryptedFinalResponse = pollResponse.text.startsWith('response=')
      ? pollResponse.text.slice('response='.length)
      : pollResponse.text;
    
    // To simulate the external client decrypting the response, we use the cryptoService 
    // with the client's private key and the server's public key (embedded in the JWE).
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;

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
    
    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jws = await cryptoService.signDataJws(compositionPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Composition/_batch`;
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

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
    
    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jws = await cryptoService.signDataJws(communicationPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const registrationUrl = `/acme/cds-es/v1/health-care/individual/org.schema/Communication/_batch`;
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

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
    (blockchainAdapter as InstanceType<typeof BlockchainAdapterMem>).addMapping(expectedHash, targetDid);
    
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
    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
    };
    const jws = await cryptoService.signDataJws(discoveryPayload, jwsProtectedHeader, externalSigner.privBytes);
    const compactJws = `${jws.protected}.${jws.payload}.${jws.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
    };
    const compactJwe = await cryptoService.encryptJweToCompact(compactJws, jweProtectedHeader, externalEncrypter, hostEncryptionKey);

    const discoveryUrl = `/acme/cds-es/v1/health-care/test-network/org.schema/Person/_discovery`;
    
    const postResponse = await invokeExpress(app, {
      method: 'POST',
      url: discoveryUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: compactJwe },
    });

    // 4. ASSERT (Phase 1): Check for 202 Accepted
    expect(postResponse.status).toBe(202);
    expect(postResponse.headers.location).toBeDefined();
    const pollingUrl = postResponse.headers.location;

    // 5. ACT (Phase 2): Wait and poll for the result
    const pollingPath = new URL(pollingUrl).pathname;
    let pollResponse: { status: number; headers: any; text: string } | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (queueAdapter instanceof QueueAdapterMem) {
        await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
      } else {
        await delay(50);
      }
      pollResponse = await invokeExpress(app, {
        method: 'POST',
        url: pollingPath,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid },
      });
      if (pollResponse.status === 200) break;
      await delay(25);
    }
      
    // 6. ASSERT (Phase 2): Decrypt and verify the final response
    expect(pollResponse?.status).toBe(200);
    const encryptedFinalResponse = pollResponse!.text.replace('response=', '');
    
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;
    
    const responseEntry = finalResponse.body.data[0];
    expect(responseEntry.response.status).toBe('200');
    expect(responseEntry.response.location).toBe(targetDid);
  });
});
