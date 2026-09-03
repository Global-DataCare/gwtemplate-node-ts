// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { GatewayRequestEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
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
import {
  EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
  EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  EXAMPLE_EMAIL_RELATED_PERSON,
  EXAMPLE_LICENSE_INVOICE_ID,
  EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE,
  EXAMPLE_RELATED_PERSON_ROLE,
} from 'gdc-common-utils-ts/examples/shared';
import { buildLicenseIssueEntry, LicenseEntryTypes } from 'gdc-common-utils-ts/utils/license';
import { Format, JobAction, Resource, Section } from 'gdc-common-utils-ts/constants/Schemas';
import { DeviceAppTypes, DeviceUserClasses } from 'gdc-common-utils-ts/constants/device';
import { FamilyRegistrationStatus, GatewayClaim } from '../../shared/gateway-claim-contract';

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
      ...(registrationPayload.body.data[0].resource?.meta?.claims || {}),
      [ClaimsOrganizationSchemaorg.alternateName]: 'ana-story',
      [ClaimsOrganizationSchemaorg.ownerEmail]: 'adult1@example.com',
      [ClaimsServiceSchemaorg.category]: 'health-care',
    };
    // An individual has no required country. The Offer jurisdiction/network
    // must be taken from `/cds-es/`, even when this claim is absent.
    delete familyClaims[ClaimsOrganizationSchemaorg.addressCountry];
    registrationPayload.body.data[0].resource = registrationPayload.body.data[0].resource || {};
    registrationPayload.body.data[0].resource.meta = {
      claims: familyClaims,
    };
    delete registrationPayload.body.data[0].meta;
    delete registrationPayload.attachments;

    const transactionSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
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
    const offerId = String(registrationEntry.resource?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');

    expect(registrationEntry.response.status).toBe('201');
    // The route, not an individual address claim, selects the Offer network.
    // This guards the live SDK/GW regression that produced `urn:cds:undefined`.
    expect(offerId).toMatch(/^urn:cds:ES:v1:health-care:product:org\.schema:Offer:/);
    expect(offerId).not.toContain('undefined');

    const orderPayload = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderPayload.thid = 'family-order-story-thid';
    orderPayload.jti = 'family-order-story-jti';
    orderPayload.body.data[0].resource = {
      meta: {
        claims: {
          '@context': Format.SCHEMA,
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId,
          [ClaimsOrderSchemaorg.paymentMethod]: EXAMPLE_LICENSE_PAYMENT_METHOD_STRIPE,
          [ClaimsOrderSchemaorg.partOfInvoice]: EXAMPLE_LICENSE_INVOICE_ID,
        },
      },
    };

    const orderSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
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
    expect(orderEntry.resource?.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);

    const licenseSearchPayload = {
      thid: EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
      jti: EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH,
      type: 'application/json',
      body: {
        data: [{
          type: LicenseEntryTypes.Search,
          resource: { meta: { claims: {} } },
        }],
      },
    };
    const licenseSearchSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
      url: `/${tenantId}/cds-es/v1/health-care/${Section.INDIVIDUAL}/${Format.SCHEMA}/${Resource.LICENSE}/${JobAction.SEARCH}`,
      headers: { 'content-type': 'application/json' },
      body: licenseSearchPayload,
    });
    expect(licenseSearchSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const licenseSearchPoll = await pollJsonBody(
      harness.app,
      licenseSearchSubmit.headers.location,
      licenseSearchPayload.thid,
    );
    expect(licenseSearchPoll.status).toBe(200);
    expect(licenseSearchPoll.body.data[0].response.status).toBe('200');

    const licenseIssueEntry = buildLicenseIssueEntry({
      email: EXAMPLE_EMAIL_RELATED_PERSON,
      role: EXAMPLE_RELATED_PERSON_ROLE,
      userClass: DeviceUserClasses.Individual,
      type: DeviceAppTypes.Mobile,
    });
    const licenseIssuePayload = {
      thid: `${EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH}-issue`,
      jti: `${EXAMPLE_JOB_IDENTIFIER_LICENSE_SEARCH}-issue`,
      type: 'application/json',
      body: {
        data: [{
          type: licenseIssueEntry.type,
          request: licenseIssueEntry.request,
          resource: { meta: { claims: licenseIssueEntry.resource.meta.claims } },
        }],
      },
    };
    const licenseIssueSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
      url: `/${tenantId}/cds-es/v1/health-care/${Section.INDIVIDUAL}/${Format.SCHEMA}/${Resource.LICENSE}/_issue`,
      headers: { 'content-type': 'application/json' },
      body: licenseIssuePayload,
    });
    expect(licenseIssueSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const licenseIssuePoll = await pollJsonBody(
      harness.app,
      licenseIssueSubmit.headers.location,
      licenseIssuePayload.thid,
    );
    expect(licenseIssuePoll.status).toBe(200);
    expect(licenseIssuePoll.body.data[0].response.status).toBe('201');

    // A confirmed registration remains discoverable through its original
    // Offer projection. This catches pending -> active rewrites that preserve
    // encrypted content but accidentally drop non-hydrated `meta.claims`.
    const offerSearchPayload = {
      thid: 'family-offer-search-story-thid',
      jti: 'family-offer-search-story-jti',
      iss: 'did:web:controller.example.com',
      aud: 'did:web:api.acme.org',
      type: 'application/json',
      body: {
        data: [{
          type: GatewayRequestEntryTypes.OfferSearch,
          meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } },
          resource: { meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } } },
        }],
      },
    };
    const offerSearchSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Offer/_search`,
      headers: { 'content-type': 'application/json' },
      body: offerSearchPayload,
    });
    expect(offerSearchSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const offerSearchPoll = await pollJsonBody(
      harness.app,
      offerSearchSubmit.headers.location,
      offerSearchPayload.thid,
    );
    expect(offerSearchPoll.status).toBe(200);
    expect(offerSearchPoll.body.data[0].response.status).toBe('200');
    expect(extractBundleSearchResources(offerSearchPoll.body).length).toBeGreaterThanOrEqual(1);

    // Re-starting the same individual is a read/idempotency outcome, not a new
    // pending Order. Channels use this status to avoid reconfirming an active
    // Offer and triggering the historical "not in pending state" conflict.
    const repeatedRegistrationPayload = structuredClone(registrationPayload);
    repeatedRegistrationPayload.thid = 'family-transaction-repeat-story-thid';
    repeatedRegistrationPayload.jti = 'family-transaction-repeat-story-jti';
    const repeatedSubmit = await invokeExpress(harness.app, {
      method: HttpRequestMethods.Post,
      url: `/${tenantId}/cds-es/v1/health-care/individual/org.schema/Organization/_transaction`,
      headers: { 'content-type': 'application/json' },
      body: repeatedRegistrationPayload,
    });
    expect(repeatedSubmit.status).toBe(202);
    await harness.queueAdapter.waitForEmptyQueue();
    const repeatedPoll = await pollJsonBody(
      harness.app,
      repeatedSubmit.headers.location,
      repeatedRegistrationPayload.thid,
    );
    expect(repeatedPoll.status).toBe(200);
    expect(repeatedPoll.body.data[0].response.status).toBe('200');
    expect(repeatedPoll.body.data[0].resource.meta.claims[GatewayClaim.FamilyRegistrationStatus]).toBe(FamilyRegistrationStatus.Existing);
    expect(repeatedPoll.body.data[0].resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toBe(offerId);
  });
});
