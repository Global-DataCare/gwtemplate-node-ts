// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { jest } from '@jest/globals';
import type { IServerConfig } from '../../../config';
import { createEnvelopeAdapter, resolveKmsProvider } from '../../../services/envelope-adapter-factory';
import {
  AesGcmEnvelopeAdapter,
  KmsEnvelopeAdapterAws,
  CloudKmsEnvelopeAdapter,
  HashicorpTransitEnvelopeAdapter,
  InMemoryEnvelopeAdapter,
  RuntimeKekEnvelopeAdapter,
} from '../../../services/kms-envelope-adapter';

function buildConfig(overrides: Partial<IServerConfig> = {}): IServerConfig {
  return {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: true,
    jsonLegacy: true,
    didcommPlainEnabled: true,
    didcommPlaintextLegacyMediaTypeEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'demo',
    port: 3000,
    maxHeaderSize: 1024,
    apiHostname: 'localhost',
    hostExternalDomain: 'localhost',
    apiBaseUrl: 'http://localhost:3000',
    namespace: 'gdc',
    sectorsAllowed: [],
    allowedPaymentMethods: [],
    dbProvider: 'mem',
    storageProvider: 'mem',
    queueProvider: 'mem',
    host: {},
    mongo: { dbName: 'default' },
    firebase: {},
    ...overrides,
  };
}

describe('envelope-adapter-factory', () => {
  it('defaults to memory when no provider and no KEK secret exist', async () => {
    const config = buildConfig();
    expect(resolveKmsProvider(config)).toBe('memory');
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(InMemoryEnvelopeAdapter);
  });

  it('keeps backward compatibility by selecting local when KEK_SECRET exists', async () => {
    const config = buildConfig({ kekSecret: 'dev-secret' });
    expect(resolveKmsProvider(config)).toBe('local');
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(AesGcmEnvelopeAdapter);
  });

  it.each(['memory', 'local'] as const)('rejects %s custody in production', async (provider) => {
    const config = buildConfig({
      nodeEnv: 'production',
      kms: { provider },
      ...(provider === 'local' ? { kekSecret: 'dev-secret' } : {}),
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('requires external KMS custody');
  });

  it('unwraps one runtime KEK with Cloud KMS and returns a local adapter', async () => {
    const rootAdapter = { wrapKeyMaterial: jest.fn(async () => 'unused'), unwrapKeyMaterial: jest.fn<any>().mockResolvedValue(Buffer.alloc(32, 7)) };
    const config = buildConfig({
      kms: {
        provider: 'gcp',
        keyId: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        runtimeKekCiphertext: 'kms-ciphertext',
        runtimeKekId: 'gw-prod',
      },
    });
    expect((await createEnvelopeAdapter(config, { rootAdapter })).adapter).toBeInstanceOf(RuntimeKekEnvelopeAdapter);
    expect(rootAdapter.unwrapKeyMaterial).toHaveBeenCalledTimes(1);
  });

  it('unwraps one runtime KEK with AWS KMS through the provider-neutral configuration', async () => {
    const rootAdapter = { wrapKeyMaterial: jest.fn(async () => 'unused'), unwrapKeyMaterial: jest.fn<any>().mockResolvedValue(Buffer.alloc(32, 7)) };
    const config = buildConfig({
      kms: {
        provider: 'aws',
        region: 'eu-west-1',
        keyId: 'arn:aws:kms:eu-west-1:111122223333:key/00000000-0000-0000-0000-000000000001',
        runtimeKekCiphertext: 'kms-ciphertext',
        runtimeKekId: 'gw-prod',
      },
    });

    expect((await createEnvelopeAdapter(config, { rootAdapter })).adapter).toBeInstanceOf(RuntimeKekEnvelopeAdapter);
    expect(rootAdapter.unwrapKeyMaterial).toHaveBeenCalledTimes(1);
  });

  it('fails fast when AWS is selected without the provider-neutral KMS key id', async () => {
    const config = buildConfig({
      kms: { provider: 'aws', region: 'eu-west-1' },
      gcpKms: {
        keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        runtimeKekCiphertext: 'legacy-gcp-ciphertext',
        runtimeKekId: 'legacy-gcp',
      },
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('KMS_KEY_ID');
  });

  it('requires KMS_REGION for AWS and does not delegate region discovery to the AWS SDK', async () => {
    const config = buildConfig({
      kms: {
        provider: 'aws',
        keyId: 'alias/gw-production',
        runtimeKekCiphertext: 'kms-ciphertext',
        runtimeKekId: 'gw-prod',
      },
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('KMS_REGION');
  });

  it('accepts the former GCP variables only for GCP migration', async () => {
    const rootAdapter = { wrapKeyMaterial: jest.fn(async () => 'unused'), unwrapKeyMaterial: jest.fn<any>().mockResolvedValue(Buffer.alloc(32, 7)) };
    const config = buildConfig({
      kms: { provider: 'gcp' },
      gcpKms: {
        keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        runtimeKekCiphertext: 'legacy-gcp-ciphertext',
        runtimeKekId: 'legacy-gcp',
      },
    });

    expect((await createEnvelopeAdapter(config, { rootAdapter })).adapter).toBeInstanceOf(RuntimeKekEnvelopeAdapter);
  });

  it('creates a HashiCorp Transit adapter when explicitly configured', async () => {
    const config = buildConfig({
      kms: { provider: 'hashicorp-transit' },
      hashicorpTransit: {
        baseUrl: 'https://vault.example.com',
        keyName: 'gw-envelope',
        token: 'token-1',
      },
    });
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(HashicorpTransitEnvelopeAdapter);
  });

  it('fails fast when GCP is selected without a key name', async () => {
    const config = buildConfig({ kms: { provider: 'gcp' } });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('KMS_KEY_ID');
  });

  it('rejects a CryptoKeyVersion where a rotatable CryptoKey name is required', async () => {
    const config = buildConfig({
      kms: { provider: 'gcp', keyId: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1' },
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('full CryptoKey resource name');
  });

  it('fails fast when hashicorp-transit is selected without required settings', async () => {
    const config = buildConfig({
      kms: { provider: 'hashicorp-transit' },
      hashicorpTransit: { baseUrl: 'https://vault.example.com' },
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('HASHICORP_TRANSIT_BASE_URL');
  });
});

describe('external envelope adapters', () => {
  it('uses the bootstrapped runtime KEK locally and authenticates tenant context', async () => {
    const adapter = new RuntimeKekEnvelopeAdapter(Buffer.alloc(32, 9));
    const context = { entityVaultId: 'tenant-1', purpose: 'all' };
    const wrapped = await adapter.wrapKeyMaterial(Buffer.from('tenant-keyset'), context);

    expect(Buffer.from(await adapter.unwrapKeyMaterial(wrapped, context)).toString()).toBe('tenant-keyset');
    await expect(adapter.unwrapKeyMaterial(wrapped, { ...context, entityVaultId: 'tenant-2' })).rejects.toThrow();
  });

  it('uses the root adapter only for a legacy direct-KMS envelope', async () => {
    const legacyRoot = {
      wrapKeyMaterial: jest.fn(async () => 'unused'),
      unwrapKeyMaterial: jest.fn(async () => Buffer.from('legacy-keyset')),
    };
    const adapter = new RuntimeKekEnvelopeAdapter(Buffer.alloc(32, 9), legacyRoot);
    const context = { entityVaultId: 'tenant-1', purpose: 'all' };
    expect(Buffer.from(await adapter.unwrapKeyMaterial('legacy-kms-ciphertext', context)).toString()).toBe('legacy-keyset');
    const current = await adapter.wrapKeyMaterial(Buffer.from('current-keyset'), context);
    expect(Buffer.from(await adapter.unwrapKeyMaterial(current, context)).toString()).toBe('current-keyset');
    expect(legacyRoot.unwrapKeyMaterial).toHaveBeenCalledTimes(1);
  });

  it('uses Cloud KMS encrypt/decrypt REST calls with authenticated context', async () => {
    const fetchImpl = jest.fn<any>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ciphertext: 'wrapped-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plaintext: Buffer.from('secret').toString('base64') }), { status: 200 }));
    const adapter = new CloudKmsEnvelopeAdapter(
      'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      { fetchImpl, tokenProvider: async () => 'token-1' },
    );

    const wrapped = await adapter.wrapKeyMaterial(Buffer.from('secret'), { entityVaultId: 'tenant-1', purpose: 'all' });
    const plain = await adapter.unwrapKeyMaterial(wrapped, { entityVaultId: 'tenant-1', purpose: 'all' });

    expect(wrapped).toBe('wrapped-1');
    expect(Buffer.from(plain).toString('utf8')).toBe('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain(':encrypt');
    expect(fetchImpl.mock.calls[1][0]).toContain(':decrypt');
  });

  it('uses AWS KMS encrypt/decrypt with the same authenticated context', async () => {
    const send = jest.fn<any>()
      .mockResolvedValueOnce({ CiphertextBlob: Buffer.from('wrapped') })
      .mockResolvedValueOnce({ Plaintext: Buffer.from('secret') });
    const keyId = 'arn:aws:kms:eu-west-1:111122223333:key/00000000-0000-0000-0000-000000000001';
    const adapter = new KmsEnvelopeAdapterAws(keyId, { send });
    const context = { entityVaultId: 'tenant-1', purpose: 'all' };

    const wrapped = await adapter.wrapKeyMaterial(Buffer.from('secret'), context);
    const plain = await adapter.unwrapKeyMaterial(wrapped, context);

    expect(wrapped).toBe(Buffer.from('wrapped').toString('base64'));
    expect(Buffer.from(plain).toString('utf8')).toBe('secret');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].input).toMatchObject({ KeyId: keyId, EncryptionContext: context });
    expect(send.mock.calls[1][0].input).toMatchObject({ KeyId: keyId, EncryptionContext: context });
  });

  it('uses HashiCorp Transit encrypt/decrypt REST calls without colliding with storage vault naming', async () => {
    const fetchImpl = jest.fn<any>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ciphertext: 'vault:v1:abc' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { plaintext: Buffer.from('secret').toString('base64') } }), { status: 200 }));
    const adapter = new HashicorpTransitEnvelopeAdapter({
      baseUrl: 'https://vault.example.com/',
      mountPath: 'transit',
      keyName: 'gw-envelope',
      token: 'token-1',
      fetchImpl,
    });

    const wrapped = await adapter.wrapKeyMaterial(Buffer.from('secret'), { entityVaultId: 'tenant-1', purpose: 'all' });
    const plain = await adapter.unwrapKeyMaterial(wrapped, { entityVaultId: 'tenant-1', purpose: 'all' });

    expect(wrapped).toBe('vault:v1:abc');
    expect(Buffer.from(plain).toString('utf8')).toBe('secret');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://vault.example.com/v1/transit/encrypt/gw-envelope');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://vault.example.com/v1/transit/decrypt/gw-envelope');
  });
});
