import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
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
});
