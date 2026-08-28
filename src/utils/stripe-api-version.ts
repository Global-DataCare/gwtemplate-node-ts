/**
 * Stripe API contract supported by the installed server SDK.
 * Centralizing it prevents webhook, Checkout, Invoicing and verification
 * clients from silently using different response schemas.
 */
export const STRIPE_API_VERSION = '2025-12-15.clover' as const;
