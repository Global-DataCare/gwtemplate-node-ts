// Flow contract: an optional webhook adapter is absent by default, fail-closed when explicitly enabled, and never blocks unrelated production startup.
import request from 'supertest';
import express from 'express';
import { resetServerConfig } from '../../server';
import { createWebhooksRouter } from '../../routes/webhooks';

describe('stripe webhook route', () => {
  const previousEnv = process.env;

  afterEach(async () => {
    process.env = previousEnv;
    resetServerConfig();
  });

  it('mounts Stripe webhook at /webhooks/stripe', async () => {
    process.env = {
      ...previousEnv,
      STRIPE_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_dummy',
    };
    const app = express();
    app.use('/webhooks', createWebhooksRouter({} as any));

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ id: 'evt_dummy', type: 'checkout.session.completed', data: { object: {} } });

    // Route should exist and fail on signature verification (400), not on missing endpoint (404).
    expect(response.status).toBe(400);
  });

  it.each([undefined, 'false'])('starts production without payment credentials when the adapter flag is %s', async (enabled) => {
    process.env = {
      ...previousEnv,
      NODE_ENV: 'production',
      STRIPE_ENABLED: enabled,
      STRIPE_SECRET_KEY: undefined,
      STRIPE_WEBHOOK_SIGNING_SECRET: undefined,
    };
    const app = express();
    app.use('/webhooks', createWebhooksRouter({} as any));

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({});

    expect(response.status).toBe(404);
  });

  it('fails startup when the payment adapter is explicitly enabled without its credentials', async () => {
    process.env = {
      ...previousEnv,
      NODE_ENV: 'production',
      STRIPE_ENABLED: 'true',
      STRIPE_SECRET_KEY: undefined,
      STRIPE_WEBHOOK_SIGNING_SECRET: undefined,
    };
    expect(() => createWebhooksRouter({} as any)).toThrow(
      'Stripe environment variables (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET) are not configured.',
    );
  });
});
