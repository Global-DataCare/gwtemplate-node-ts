// src/routes/webhooks.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import * as stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { QueueAdapter } from '../adapters/queue';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { createJobName } from '../utils/naming';

/**
 * Creates a router for handling third-party webhooks, like Stripe.
 * @param queueAdapter The queue adapter for adding jobs.
 */
export function createWebhooksRouter(queueAdapter: QueueAdapter): express.Router {
  const router = express.Router();

  // Stripe is an optional integration surface. In production, we fail fast if it's enabled but misconfigured.
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SIGNING_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Stripe environment variables (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET) are not configured.',
      );
    }
    console.warn('[Webhooks] Stripe not configured. /webhooks/stripe will be disabled.');
    return router;
  }

  const stripeClient = new stripe.Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-12-15.clover' });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;


  // CRITICAL: Use `express.raw` to get the raw request body. Stripe's signature verification
  // fails if the body is parsed as JSON beforehand by `express.json()`.
  router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event: stripe.Stripe.Event;
    try {
      // 1. Verify the event's signature to ensure it's from Stripe
      event = stripeClient.webhooks.constructEvent(req.body, sig!, webhookSecret);
    } catch (err: any) {
      console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 2. Handle the specific event type
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object as stripe.Stripe.Checkout.Session;
        
        // We need a way to link the Stripe session back to our tenant.
        // The BEST practice is to set `client_reference_id` to our internal `tenantId`
        // when we create the checkout session in the first place.
        const tenantId = session.client_reference_id;
        const quantity = parseInt(session.metadata?.quantity || '1', 10); // Assume quantity is in metadata

        if (!tenantId) {
          console.error(`[Stripe Webhook] Critical: 'checkout.session.completed' event received without a client_reference_id. Cannot assign licenses.`);
          // Return 200 to Stripe so it doesn't retry, but log the error for investigation.
          return res.status(200).json({ received: true, error: "Missing client_reference_id" });
        }

        // 3. Enqueue a job for the worker to process asynchronously
        console.log(`[Stripe Webhook] Received successful payment for tenant '${tenantId}'. Queueing license generation job for ${quantity} licenses.`);
        
        const jobName = createJobName('system', 'License', 'create');
        const jobRequest: JobRequest = {
          id: event.id,
          sequence: 0,
          status: 'DRAFT' as any,
          createdAtTimestamp: Date.now(),
          tenantId: 'host', // The job is processed by the host system
          section: 'system',
          format: 'org.schema',
          resourceType: 'License',
          action: 'create',
          content: {
              iss: 'did:web:stripe.com',
              jti: uuidv4(),
              type: 'internal/license-generation',
              thid: event.id, // Use the event ID for idempotency
              body: {
                  targetTenantId: tenantId, // The tenant who gets the licenses
                  quantity: quantity,
                  plan: session.metadata?.plan || 'default',
              },
              aud: ''
          },
        };
        
        await queueAdapter.addJob(jobName, jobRequest);
        break;
        
      // ... handle other event types as needed
      default:
        console.log(`[Stripe Webhook] Received unhandled event type ${event.type}`);
    }

    // 4. Acknowledge receipt of the event to Stripe
    res.status(200).json({ received: true });
  });

  return router;
}
