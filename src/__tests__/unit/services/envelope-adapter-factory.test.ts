import { jest } from '@jest/globals';
import type { IServerConfig } from '../../../config';
import { createEnvelopeAdapter, resolveEnvelopeProvider } from '../../../services/envelope-adapter-factory';
import {
  AesGcmEnvelopeAdapter,
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
    expect(resolveEnvelopeProvider(config)).toBe('memory');
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(InMemoryEnvelopeAdapter);
  });

  it('keeps backward compatibility by selecting local when KEK_SECRET exists', async () => {
    const config = buildConfig({ kekSecret: 'dev-secret' });
    expect(resolveEnvelopeProvider(config)).toBe('local');
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(AesGcmEnvelopeAdapter);
  });

  it.each(['memory', 'local'] as const)('rejects %s custody in production', async (provider) => {
    const config = buildConfig({
      nodeEnv: 'production',
      envelope: { provider },
      ...(provider === 'local' ? { kekSecret: 'dev-secret' } : {}),
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('requires external envelope custody');
  });

  it('unwraps one runtime KEK with Cloud KMS and returns a local adapter', async () => {
    const rootAdapter = { wrapKeyMaterial: jest.fn(async () => 'unused'), unwrapKeyMaterial: jest.fn<any>().mockResolvedValue(Buffer.alloc(32, 7)) };
    const config = buildConfig({
      envelope: { provider: 'gcp-kms' },
      gcpKms: {
        keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        runtimeKekCiphertext: 'kms-ciphertext',
        runtimeKekId: 'gw-prod',
      },
    });
    expect((await createEnvelopeAdapter(config, { rootAdapter })).adapter).toBeInstanceOf(RuntimeKekEnvelopeAdapter);
    expect(rootAdapter.unwrapKeyMaterial).toHaveBeenCalledTimes(1);
  });

  it('creates a HashiCorp Transit adapter when explicitly configured', async () => {
    const config = buildConfig({
      envelope: { provider: 'hashicorp-transit' },
      hashicorpTransit: {
        baseUrl: 'https://vault.example.com',
        keyName: 'gw-envelope',
        token: 'token-1',
      },
    });
    expect((await createEnvelopeAdapter(config)).adapter).toBeInstanceOf(HashicorpTransitEnvelopeAdapter);
  });

  it('fails fast when gcp-kms is selected without a key name', async () => {
    const config = buildConfig({ envelope: { provider: 'gcp-kms' } });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('GCP_KMS_KEY_NAME');
  });

  it('rejects a CryptoKeyVersion where a rotatable CryptoKey name is required', async () => {
    const config = buildConfig({
      envelope: { provider: 'gcp-kms' },
      gcpKms: { keyName: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1' },
    });
    await expect(createEnvelopeAdapter(config)).rejects.toThrow('full CryptoKey resource name');
  });

  it('fails fast when hashicorp-transit is selected without required settings', async () => {
    const config = buildConfig({
      envelope: { provider: 'hashicorp-transit' },
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
