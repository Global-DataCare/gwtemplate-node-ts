#!/usr/bin/env node
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const fhirBaseUrl = String(process.env.HAPI_FHIR_BASE_URL || 'http://localhost:18080/fhir').replace(/\/$/, '');
const callbackPort = Number(process.env.HAPI_FHIR_CALLBACK_PORT || 18081);
const callbackHost = process.env.HAPI_FHIR_CALLBACK_HOST || '0.0.0.0';
const callbackUrl = process.env.HAPI_FHIR_CALLBACK_URL
  || `http://host.docker.internal:${callbackPort}/fhir/r5/subscriptions/hapi/notifications`;
const timeoutMs = Number(process.env.HAPI_FHIR_E2E_TIMEOUT_MS || 120_000);

async function fhir(path, init = {}) {
  const response = await fetch(`${fhirBaseUrl}/${String(path).replace(/^\//, '')}`, {
    ...init,
    headers: {
      accept: 'application/fhir+json',
      ...(init.body ? { 'content-type': 'application/fhir+json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!response.ok) {
    throw new Error(`FHIR ${init.method || 'GET'} ${path} returned ${response.status}: ${text.slice(0, 1000)}`);
  }
  return body;
}

async function waitForHapi() {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const metadata = await fhir('metadata');
      if (metadata?.resourceType === 'CapabilityStatement') return metadata;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`HAPI FHIR did not become ready within ${timeoutMs} ms.`);
}

function startCallback() {
  const notifications = [];
  const seenBundleIds = new Set();
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (bundle?.id && !seenBundleIds.has(bundle.id)) {
          seenBundleIds.add(bundle.id);
          notifications.push(bundle);
        }
        response.writeHead(204);
        response.end();
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(callbackPort, callbackHost, () => resolve({ server, notifications }));
  });
}

async function waitForNotification(notifications, observationId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = notifications.find((bundle) =>
      bundle?.type === 'subscription-notification'
      && bundle.entry?.[0]?.resource?.resourceType === 'SubscriptionStatus'
      && bundle.entry?.some((entry) => entry?.resource?.resourceType === 'Observation'
        && entry.resource.id === observationId));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No HAPI FHIR notification arrived for Observation/${observationId}.`);
}

async function waitForSubscriptionActive(subscriptionId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const subscription = await fhir(`Subscription/${subscriptionId}`);
    if (subscription.status === 'active') return subscription;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Subscription/${subscriptionId} did not become active.`);
}

const suffix = randomUUID();
const patientId = `gw-core-hapi-${suffix}`;
const topicUrl = `https://example.invalid/fhir/SubscriptionTopic/gw-core-observation-${suffix}`;
const { server, notifications } = await startCallback();

try {
  const metadata = await waitForHapi();
  assert.equal(metadata.fhirVersion, '5.0.0');
  const resources = metadata.rest?.flatMap((rest) => rest.resource || []) || [];
  assert.equal(resources.some((resource) => resource.type === 'Subscription'), true);
  assert.equal(resources.some((resource) => resource.type === 'SubscriptionTopic'), true);

  await fhir(`Patient/${patientId}`, {
    method: 'PUT',
    body: JSON.stringify({ resourceType: 'Patient', id: patientId, active: true }),
  });
  await fhir('SubscriptionTopic', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'SubscriptionTopic', status: 'active', url: topicUrl,
      title: 'GW CORE local Observation creation',
      resourceTrigger: [{ resource: 'Observation', supportedInteraction: ['create'] }],
      canFilterBy: [{ resource: 'Observation', filterParameter: 'patient' }],
    }),
  });
  const subscription = await fhir('Subscription', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'Subscription', status: 'requested', topic: topicUrl,
      reason: 'GW CORE local HAPI FHIR R5 subscription E2E',
      channelType: {
        system: 'http://terminology.hl7.org/CodeSystem/subscription-channel-type',
        code: 'rest-hook',
      },
      endpoint: callbackUrl, contentType: 'application/fhir+json', content: 'full-resource',
      filterBy: [{ resourceType: 'Observation', filterParameter: 'patient', comparator: 'eq', value: `Patient/${patientId}` }],
    }),
  });
  assert.ok(subscription.id);
  await waitForSubscriptionActive(subscription.id);

  const observation = await fhir('Observation', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'Observation', status: 'final',
      code: { text: 'GW CORE HAPI subscription E2E' },
      subject: { reference: `Patient/${patientId}` }, valueString: 'delivered',
    }),
  });
  const notification = await waitForNotification(notifications, observation.id);
  assert.equal(notification.entry[0].resource.subscription.reference, `Subscription/${subscription.id}`);
  console.log(JSON.stringify({
    ok: true,
    fhirVersion: metadata.fhirVersion,
    subscriptionId: subscription.id,
    observationId: observation.id,
    notificationBundleId: notification.id,
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
