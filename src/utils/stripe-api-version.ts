/**
 * Stripe API contract supported by the installed server SDK.
 * Centralizing it prevents webhook, Checkout, Invoicing and verification
 * clients from silently using different response schemas.
 */
export const STRIPE_API_VERSION = '2026-02-25.clover' as const;
