// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionRuntimeKek } from '../provision-runtime-kek.mjs';

test('provisions an AWS runtime KEK with provider-neutral inputs and authenticated context', async () => {
  const runtimeKek = Buffer.alloc(32, 7);
  let received;
  const output = await provisionRuntimeKek({
    env: {
      ENVELOPE_PROVIDER: 'aws-kms',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    },
    randomBytes: () => runtimeKek,
    awsEncrypt: async (keyId, plaintext, context) => {
      received = { keyId, plaintext: Buffer.from(plaintext), context };
      return 'aws-ciphertext';
    },
  });

  assert.equal(output, 'KMS_RUNTIME_KEK_CIPHERTEXT=aws-ciphertext');
  assert.equal(received.keyId, 'alias/gw-production');
  assert.deepEqual(received.context, {
    entityVaultId: 'gw-production',
    purpose: 'service-runtime-kek-v1',
  });
  assert.deepEqual(received.plaintext, Buffer.alloc(32, 7));
  assert.deepEqual(runtimeKek, Buffer.alloc(32));
});

test('keeps the deprecated GCP names only as migration aliases', async () => {
  const output = await provisionRuntimeKek({
    env: {
      ENVELOPE_PROVIDER: 'gcp-kms',
      GCP_KMS_KEY_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      GCP_KMS_RUNTIME_KEK_ID: 'legacy-gw',
    },
    randomBytes: () => Buffer.alloc(32, 3),
    gcpEncrypt: async () => 'gcp-ciphertext',
  });

  assert.equal(output, 'KMS_RUNTIME_KEK_CIPHERTEXT=gcp-ciphertext');
});
