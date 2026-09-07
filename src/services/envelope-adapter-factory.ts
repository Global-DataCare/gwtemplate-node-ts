import type { IServerConfig } from '../config';
import {
  AesGcmEnvelopeAdapter,
  KmsEnvelopeAdapterAws,
  CloudKmsEnvelopeAdapter,
  HashicorpTransitEnvelopeAdapter,
  InMemoryEnvelopeAdapter,
  RuntimeKekEnvelopeAdapter,
  type KmsEnvelopeAdapter,
} from './kms-envelope-adapter';

export type EnvelopeProvider = 'memory' | 'local' | 'gcp-kms' | 'aws-kms' | 'hashicorp-transit';

export function resolveEnvelopeProvider(config: IServerConfig): EnvelopeProvider {
  if (config.envelope?.provider) {
    return config.envelope.provider;
  }
  if (config.kekSecret) {
    return 'local';
  }
  return 'memory';
}

function assertProductionCustody(config: IServerConfig, provider: EnvelopeProvider): void {
  if (config.nodeEnv !== 'production') return;
  if (provider === 'memory' || provider === 'local') {
    throw new Error(
      `NODE_ENV=production requires external envelope custody; ENVELOPE_PROVIDER=${provider} is not permitted. Use gcp-kms, aws-kms, or hashicorp-transit.`,
    );
  }
}

export async function createEnvelopeAdapter(
  config: IServerConfig,
  deps: { rootAdapter?: KmsEnvelopeAdapter } = {},
): Promise<{
  adapter: KmsEnvelopeAdapter;
  provider: EnvelopeProvider;
}> {
  const provider = resolveEnvelopeProvider(config);
  assertProductionCustody(config, provider);

  if (provider === 'memory') {
    return { adapter: new InMemoryEnvelopeAdapter(), provider };
  }

  if (provider === 'local') {
    if (!config.kekSecret) {
      throw new Error('ENVELOPE_PROVIDER=local requires KEK_SECRET.');
    }
    return { adapter: new AesGcmEnvelopeAdapter(config.kekSecret), provider };
  }

  if (provider === 'gcp-kms' || provider === 'aws-kms') {
    const legacyGcp = provider === 'gcp-kms' ? config.gcpKms : undefined;
    const keyId = String(config.kms?.keyId || legacyGcp?.keyName || '').trim();
    const runtimeKekCiphertext = String(config.kms?.runtimeKekCiphertext || legacyGcp?.runtimeKekCiphertext || '').trim();
    const runtimeKekId = String(config.kms?.runtimeKekId || legacyGcp?.runtimeKekId || '').trim();
    if (!keyId) {
      throw new Error(`ENVELOPE_PROVIDER=${provider} requires KMS_KEY_ID.`);
    }
    if (provider === 'gcp-kms' && !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyId)) {
      throw new Error('ENVELOPE_PROVIDER=gcp-kms requires KMS_KEY_ID as a full CryptoKey resource name (without a CryptoKeyVersion suffix).');
    }
    if (!runtimeKekCiphertext || !runtimeKekId) {
      throw new Error(`ENVELOPE_PROVIDER=${provider} requires KMS_RUNTIME_KEK_CIPHERTEXT and KMS_RUNTIME_KEK_ID.`);
    }
    const rootAdapter = deps.rootAdapter || (provider === 'gcp-kms'
      ? new CloudKmsEnvelopeAdapter(keyId)
      : new KmsEnvelopeAdapterAws(keyId));
    const runtimeKek = await rootAdapter.unwrapKeyMaterial(runtimeKekCiphertext, {
      entityVaultId: runtimeKekId,
      purpose: 'service-runtime-kek-v1',
    });
    try {
      return { adapter: new RuntimeKekEnvelopeAdapter(runtimeKek, rootAdapter), provider };
    } finally {
      Buffer.from(runtimeKek.buffer, runtimeKek.byteOffset, runtimeKek.byteLength).fill(0);
    }
  }

  const baseUrl = String(config.hashicorpTransit?.baseUrl || '').trim();
  const keyName = String(config.hashicorpTransit?.keyName || '').trim();
  const token = String(config.hashicorpTransit?.token || '').trim();
  if (!baseUrl || !keyName || !token) {
    throw new Error(
      'ENVELOPE_PROVIDER=hashicorp-transit requires HASHICORP_TRANSIT_BASE_URL, HASHICORP_TRANSIT_KEY_NAME, and HASHICORP_TRANSIT_TOKEN.',
    );
  }
  return {
    adapter: new HashicorpTransitEnvelopeAdapter({
      baseUrl,
      keyName,
      token,
      mountPath: config.hashicorpTransit?.mountPath,
      namespace: config.hashicorpTransit?.namespace,
    }),
    provider,
  };
}
