/**
 * Flow contract:
 * - every Stripe client uses one SDK-compatible API version;
 * - webhook, checkout, invoice and payment verification cannot drift apart;
 * - changing the Stripe SDK requires one reviewed contract update.
 */
import { STRIPE_API_VERSION } from '../../../utils/stripe-api-version';

describe('Stripe API version contract', () => {
  it('matches the API version supported by the installed SDK', () => {
    expect(STRIPE_API_VERSION).toBe('2025-12-15.clover');
  });
});
