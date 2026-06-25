import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { StoryHarness } from './helpers/story-flow';
import {
  installBasicJsonFetchMock,
  onboardTenantViaActivateAndOrder,
  pollJsonBody,
  startStoryServer,
  stopStoryServer,
} from './helpers/story-flow';
import { invokeExpress } from './helpers/invokeExpress';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import {
  FAMILY_ORDER_REQUEST,
  FAMILY_REGISTRATION_TRANSACTION_REQUEST,
} from '../data/example-payloads';

describe('Family transaction Offer/Order route story', () => {
  let harness: StoryHarness;
  let tenantId: string;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = installBasicJsonFetchMock();
    harness = await startStoryServer();
    tenantId = await onboardTenantViaActivateAndOrder(harness.app, harness.queueAdapter);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await stopStoryServer(harness);
  });

  it('submit family _transaction, poll Offer, submit Order, and poll family confirmation', async () => {
    const registrationPayload = structuredClone(FAMILY_REGISTRATION_TRANSACTION_REQUEST) as any;
    registrationPayload.thid = 'family-transaction-story-thid';
    registrationPayload.jti = 'family-transaction-story-jti';
    const familyClaims = {
      ...(registrationPayload.body.data[0].meta?.claims || {}),
      [ClaimsOrganizationSchemaorg.alternateName]: 'ana-story',
      [ClaimsOrganizationSchemaorg.ownerEmail]: 'adult1@example.com',
      [ClaimsServiceSchemaorg.category]: 'health-care',
    };
    registrationPayload.body.data[0].resource = registrationPayload.body.data[0].resource || {};
    registrationPayload.body.data[0].resource.meta = {
      claims: familyClaims,
    };
    registrationPayload.body.data[0].meta = { claims: familyClaims };
    delete registrationPayload.attachments;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_transaction`,
      headers: { 'content-type': 'application/json' },
      body: registrationPayload,
    });

    expect(transactionSubmit.status).toBe(202);
    expect(transactionSubmit.headers.location).toContain('/_transaction-response');

    await harness.queueAdapter.waitForEmptyQueue();

    const transactionPoll = await pollJsonBody(harness.app, transactionSubmit.headers.location, registrationPayload.thid);
    expect(transactionPoll.status).toBe(200);

    const registrationEntry = transactionPoll.body.data[0];
    const offerId = String(registrationEntry.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(registrationEntry.response.status).toBe('201');
    expect(offerId).toContain(':Offer:');

    const orderPayload = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderPayload.thid = 'family-order-story-thid';
    orderPayload.jti = 'family-order-story-jti';
    orderPayload.body.data[0].meta = {
      claims: {
        '@context': 'org.schema',
        'Order.acceptedOffer.identifier': offerId,
        'Order.paymentMethod': 'Stripe',
        'Order.partOfInvoice': 'family-transaction-story-invoice',
      },
    };
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          '@context': 'org.schema',
          'Order.acceptedOffer.identifier': offerId,
          'Order.paymentMethod': 'Stripe',
          'Order.partOfInvoice': 'family-transaction-story-invoice',
        },
      },
    };

    const orderSubmit = await invokeExpress(harness.app, {
      method: 'POST',
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Order/_batch`,
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
