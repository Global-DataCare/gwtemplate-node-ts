import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { StoryHarness } from './helpers/story-flow';
import { installIcaVerifyFetchMock, pollJsonBody, startStoryServer, stopStoryServer } from './helpers/story-flow';
import { invokeExpress } from './helpers/invokeExpress';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST,
} from '../data/example-payloads';

describe('Host transaction Offer/Order route story', () => {
  let harness: StoryHarness;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = installIcaVerifyFetchMock();
    harness = await startStoryServer();
  });

  afterEach(() => {
    (global.fetch as any).mockClear?.();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await stopStoryServer(harness);
  });

  it('submit _transaction, poll Offer, submit Order, and poll commercial confirmation', async () => {
    const transactionPayload = structuredClone(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST) as any;
    transactionPayload.thid = 'host-transaction-story-thid';
    transactionPayload.jti = 'host-transaction-story-jti';
    transactionPayload.body.data[0].resource = transactionPayload.body.data[0].resource || {};
    transactionPayload.body.data[0].resource.meta = {
      claims: {
        ...(transactionPayload.body.data[0].meta?.claims || {}),
        [ClaimsPersonSchemaorg.email]: 'admin1@acme.org',
        'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN',
      },
    };
    transactionPayload.body.data[0].meta = {};

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Organization/_transaction',
      headers: { 'content-type': 'application/json' },
      body: transactionPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    expect(transactionSubmit.headers.location).toContain('/_transaction-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const transactionPoll = await pollJsonBody(harness.app, transactionSubmit.headers.location, transactionPayload.thid);
    expect(transactionPoll.status).toBe(200);

    const transactionEntry = transactionPoll.body.data[0];
    const offerId = String(transactionEntry.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(transactionEntry.response.status).toBe('200');
    expect(transactionEntry.resource?.next?.action).toBe('Order/_batch');
    expect(transactionEntry.resource?.next?.acceptedOffer?.identifier).toBe(offerId);
    expect(offerId).toContain(':Offer:');

    const orderPayload = structuredClone(ORGANIZATION_ORDER_REQUEST) as any;
    orderPayload.thid = 'host-transaction-order-thid';
    orderPayload.jti = 'host-transaction-order-jti';
    orderPayload.body.data[0].meta = {
      claims: {
        '@context': 'org.schema',
        'Order.acceptedOffer.identifier': offerId,
        'Order.paymentMethod': 'Stripe',
        'Order.partOfInvoice': 'host-transaction-story-invoice',
      },
    };
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          '@context': 'org.schema',
          'Order.acceptedOffer.identifier': offerId,
          'Order.paymentMethod': 'Stripe',
          'Order.partOfInvoice': 'host-transaction-story-invoice',
        },
      },
    };

    const orderSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
      headers: { 'content-type': 'application/json' },
      body: orderPayload,
    });

    expect(orderSubmit.status).toBe(202);
    expect(orderSubmit.headers.location).toContain('/_batch-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const orderPoll = await pollJsonBody(harness.app, orderSubmit.headers.location, orderPayload.thid);
    expect(orderPoll.status).toBe(200);

    const orderEntry = orderPoll.body.data[0];
    expect(orderEntry.response.status).toBe('201');
    expect(orderEntry.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
  });
});
