process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.SECURITY_MODE = 'demo';
process.env.NETWORK_MODE = 'test';
process.env.JSON_LEGACY = 'true';
process.env.FHIR_LEGACY = 'true';
process.env.DIDCOMM_PLAIN = 'true';
process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
process.env.DB_PROVIDER = 'mem';
process.env.STORAGE_PROVIDER = 'mem';
process.env.QUEUE_PROVIDER = 'mem';
process.env.MAINSECTOR = 'health';
process.env.SUBSECTORSALLOWED = 'care';
process.env.HOST_EXTERNAL_DOMAIN = 'host.example.com';
process.env.HOST_LEGAL_NAME = 'Test Host';
process.env.HOST_JURISDICTION = 'ES';
process.env.HOST_ID_TYPE = 'TAX';
process.env.HOST_ID_VALUE = 'VATES-B00000000';
process.env.HOST_ADMIN_EMAIL = 'host-admin@example.com';
process.env.HOST_ADMIN_UID = 'host-admin';
process.env.HOST_ADMIN_ROLE = 'RESPRSN';
process.env.HOST_TERMS_URL = 'https://host.example.com/terms';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type * as express from 'express';
import type { Server } from 'http';
import type { QueueAdapterMem } from '../../adapters/queue-mem';
import { startServer, resetServerConfig } from '../../server';
import { invokeExpress } from './helpers/invokeExpress';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testClaimsTenant1Registration } from '../data/end-to-end.data';
import { ORGANIZATION_ORDER_REQUEST } from '../data/example-payloads';

function buildActivationPayload(): Record<string, unknown> {
  const vpTokenCompact = [
    Buffer.from(JSON.stringify({ alg: 'ML-DSA-44', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({
      sub: 'did:web:controller.example.com',
      vp: {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'OrganizationCredential'],
            credentialSubject: {
              id: 'did:web:api.acme.org',
              taxID: 'VATES-B00112233',
              category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
              serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
            },
          },
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
            credentialSubject: {
              id: 'urn:person:identifier:controller-001',
              memberOf: {
                taxID: 'VATES-B00112233',
              },
              hasOccupation: {
                identifier: {
                  value: 'RESPRSN',
                },
              },
              hasCredential: {
                material: 'controller-sig-kid',
              },
            },
          },
        ],
      },
    })).toString('base64url'),
    'mock-signature',
  ].join('.');

  return {
    thid: 'activation-route-story-thid',
    jti: 'activation-route-story-jti',
    iss: 'did:web:controller.example.com',
    aud: 'did:web:host.example.com',
    type: 'application/json',
    body: {
      vp_token: vpTokenCompact,
      organizationCredential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:web:api.acme.org',
          taxID: 'VATES-B00112233',
          category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
          serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
        },
      },
      representativeCredential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'urn:person:identifier:controller-001',
          memberOf: {
            taxID: 'VATES-B00112233',
          },
          hasOccupation: { identifier: { value: 'RESPRSN' } },
          hasCredential: { material: 'controller-sig-kid' },
        },
      },
      data: [
        {
          type: 'Organization-activation-request-v1.0',
          meta: {},
          resource: {
            meta: {
              claims: { ...testClaimsTenant1Registration },
            },
          },
          request: { method: 'POST' },
        },
      ],
    },
    meta: {
      jws: {
        protected: {
          alg: 'ML-DSA-44',
          kid: 'controller-sig-kid',
          jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub' },
        },
      },
      jwe: {
        header: {
          enc: 'A256GCM',
          skid: 'controller-enc-kid',
          jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x' },
        },
      },
    },
  };
}

describe('Host activation Offer/Order route story', () => {
  let app: express.Express;
  let server: Server | undefined;
  let queueAdapter: QueueAdapterMem;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    resetServerConfig();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => ({}),
      text: async () => '',
    })) as any;
    const serverInstance = await startServer({ listen: false });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter as QueueAdapterMem;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    resetServerConfig();
    global.fetch = originalFetch;
    if (queueAdapter) {
      queueAdapter.stop();
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  });

  it('submit _activate, poll Offer, submit Order, and poll commercial confirmation', async () => {
    const activationPayload = buildActivationPayload();
    const activationUrl = '/host/cds-es/v1/test/registry/org.schema/Organization/_activate';

    const activationSubmit = await invokeExpress(app, {
      method: 'POST',
      url: activationUrl,
      headers: { 'content-type': 'application/json' },
      body: activationPayload,
    });

    expect(activationSubmit.status).toBe(202);
    expect(activationSubmit.headers.location).toContain('/_activate-response');

    await queueAdapter.waitForEmptyQueue();

    const activationPollPath = new URL(activationSubmit.headers.location, 'http://localhost').pathname;
    const activationPoll = await invokeExpress(app, {
      method: 'POST',
      url: activationPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: activationPayload.thid },
    });

    expect(activationPoll.status).toBe(200);

    const activationResult = JSON.parse(activationPoll.text) as { data: Array<Record<string, any>> };
    const activationEntry = activationResult.data[0];
    const offerId = String(activationEntry.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(activationEntry.response.status).toBe('201');
    expect(offerId).toContain(':Offer:');

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'activation-route-order-thid';
    orderPayload.jti = 'activation-route-order-jti';
    orderPayload.iss = 'did:web:controller.example.com';
    orderPayload.aud = 'did:web:host.example.com';
    orderPayload.body.data[0].resource = orderPayload.body.data[0].resource || {};
    orderPayload.body.data[0].resource.meta = orderPayload.body.data[0].resource.meta || {};
    orderPayload.body.data[0].resource.meta.claims = {
      ...(orderPayload.body.data[0].meta?.claims || {}),
      [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
      [ClaimsOrderSchemaorg.paymentMethod]: 'Stripe',
      [ClaimsOrderSchemaorg.partOfInvoice]: 'in_activation_route_story',
    };
    orderPayload.body.data[0].meta = {};

    const orderSubmit = await invokeExpress(app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(orderSubmit.status).toBe(202);
    expect(orderSubmit.headers.location).toContain('/_batch-response');

    await queueAdapter.waitForEmptyQueue();

    const orderPollPath = new URL(orderSubmit.headers.location, 'http://localhost').pathname;
    const orderPoll = await invokeExpress(app, {
      method: 'POST',
      url: orderPollPath,
      headers: { 'content-type': 'application/json' },
      body: { thid: orderPayload.thid },
    });

    expect(orderPoll.status).toBe(200);

    const orderResult = JSON.parse(orderPoll.text) as { data: Array<Record<string, any>> };
    const orderEntry = orderResult.data[0];

    expect(orderEntry.response.status).toBe('201');
    expect(orderEntry.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
  });
});
