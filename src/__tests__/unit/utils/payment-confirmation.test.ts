import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';

/**
 * Flow contract: portal-managed seat Orders always carry auditable payment and
 * invoice evidence, including zero-price Test Network orders verified by the
 * configured mock provider.
 */
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  PAYMENT_METHOD_STRIPE,
  PAYMENT_ORCHESTRATION_MODE_GW_CORE,
  PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF,
  PAYMENT_VERIFICATION_MODE_MOCK,
  verifyOrderPaymentConfirmation,
} from '../../../utils/payment-confirmation';

describe('payment-confirmation', () => {
  const previousMode = process.env.PAYMENT_ORCHESTRATION_MODE;
  const previousVerificationMode = process.env.PAYMENT_VERIFICATION_MODE;

  beforeEach(() => {
    process.env.PAYMENT_VERIFICATION_MODE = PAYMENT_VERIFICATION_MODE_MOCK;
  });

  afterEach(() => {
    process.env.PAYMENT_ORCHESTRATION_MODE = previousMode;
    process.env.PAYMENT_VERIFICATION_MODE = previousVerificationMode;
  });

  it('accepts paid Stripe confirmation in portal-bff mode when proof is present', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

    const result = await verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.price]: '49.99',
      },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_STRIPE,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'in_test_001',
      },
    });

    expect(result.verified).toBe(true);
    expect(result.invoiceId).toBe('in_test_001');
    expect(result.paymentMethod).toBe(PAYMENT_METHOD_STRIPE);
  });

  it('accepts a zero-price test-network offer only with an auditable mock payment proof', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    process.env.PAYMENT_VERIFICATION_MODE = PAYMENT_VERIFICATION_MODE_MOCK;

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_STRIPE,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'in_test_zero_001',
      },
    })).resolves.toEqual({
      verified: true,
      paymentMethod: PAYMENT_METHOD_STRIPE,
      invoiceId: 'in_test_zero_001',
      paymentUrl: undefined,
    });
  });

  it('rejects a zero-price portal order that skips payment and invoice evidence', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: { [ClaimsOfferSchemaorg.price]: '0' },
      orderClaims: {},
    })).rejects.toThrow('Portal-managed payment confirmation requires Order.paymentMethod');
  });

  it('rejects portal-bff paid orders without proof', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;

    await expect(
      verifyOrderPaymentConfirmation({
        offerClaims: {
          [ClaimsOfferSchemaorg.price]: '49.99',
        },
        orderClaims: {},
      }),
    ).rejects.toThrow('Portal-managed payment confirmation requires Order.paymentMethod');
  });

  it('keeps gw-core mode backward compatible for paid offers without explicit proof', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_GW_CORE;

    const result = await verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.price]: '49.99',
      },
      orderClaims: {},
    });

    expect(result.verified).toBe(true);
  });

  it('verifies Stripe live checkout against offer, tenant, quantity, amount and currency', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    process.env.PAYMENT_VERIFICATION_MODE = 'live';
    const stripeClient = {
      checkout: { sessions: { retrieve: async () => ({
        payment_status: 'paid',
        client_reference_id: 'tenant-001',
        amount_total: 9998,
        currency: 'eur',
        metadata: { offerId: 'offer-001', quantity: '2' },
      }) } },
      invoices: { retrieve: async () => { throw new Error('not used'); } },
    } as any;

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.identifier]: 'offer-001',
        [ClaimsOfferSchemaorg.price]: '49.99',
        [ClaimsOfferSchemaorg.priceCurrency]: 'EUR',
        [ClaimsOfferSchemaorg.eligibleQuantityValue]: 2,
        [ClaimsOrganizationSchemaorg.alternateName]: 'tenant-001',
      },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_STRIPE,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'cs_test_001',
      },
      stripeClient,
    })).resolves.toMatchObject({ verified: true, invoiceId: 'cs_test_001' });
  });

  it('rejects a paid Stripe checkout bound to another offer', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = PAYMENT_ORCHESTRATION_MODE_PORTAL_BFF;
    process.env.PAYMENT_VERIFICATION_MODE = 'live';
    const stripeClient = {
      checkout: { sessions: { retrieve: async () => ({
        payment_status: 'paid', client_reference_id: 'tenant-001', amount_total: 9998, currency: 'eur',
        metadata: { offerId: 'another-offer', quantity: '2' },
      }) } },
      invoices: { retrieve: async () => { throw new Error('not used'); } },
    } as any;

    await expect(verifyOrderPaymentConfirmation({
      offerClaims: {
        [ClaimsOfferSchemaorg.identifier]: 'offer-001', [ClaimsOfferSchemaorg.price]: '49.99',
        [ClaimsOfferSchemaorg.priceCurrency]: 'EUR', [ClaimsOfferSchemaorg.eligibleQuantityValue]: 2,
        [ClaimsOrganizationSchemaorg.alternateName]: 'tenant-001',
      },
      orderClaims: {
        [ClaimsOrderSchemaorg.paymentMethod]: PAYMENT_METHOD_STRIPE,
        [ClaimsOrderSchemaorg.partOfInvoice]: 'cs_test_001',
      },
      stripeClient,
    })).rejects.toThrow('does not match offer');
  });
});
