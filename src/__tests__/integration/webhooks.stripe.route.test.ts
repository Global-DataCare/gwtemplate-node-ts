import request from 'supertest';
import { startServer, resetServerConfig } from '../../server';
import { QueueAdapterMem } from '../../adapters/queue-mem';

describe('stripe webhook route', () => {
  const previousEnv = process.env;
  const queueAdapters: QueueAdapterMem[] = [];

  afterEach(async () => {
    for (const queueAdapter of queueAdapters.splice(0)) {
      queueAdapter.stop();
    }
    process.env = previousEnv;
    resetServerConfig();
  });

  it('mounts Stripe webhook at /webhooks/stripe', async () => {
    process.env = {
      ...previousEnv,
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_dummy',
    };
    resetServerConfig();

    const { app, queueAdapter } = await startServer({ listen: false });
    if (queueAdapter instanceof QueueAdapterMem) {
      queueAdapters.push(queueAdapter);
    }

    const response = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send({ id: 'evt_dummy', type: 'checkout.session.completed', data: { object: {} } });

    // Route should exist and fail on signature verification (400), not on missing endpoint (404).
    expect(response.status).toBe(400);
  });
});
