import type { IServerConfig } from '../config';
import {
  AesGcmEnvelopeAdapter,
  CloudKmsEnvelopeAdapter,
  HashicorpTransitEnvelopeAdapter,
  InMemoryEnvelopeAdapter,
  type KmsEnvelopeAdapter,
} from './kms-envelope-adapter';

export type EnvelopeProvider = 'memory' | 'local' | 'gcp-kms' | 'hashicorp-transit';

export function resolveEnvelopeProvider(config: IServerConfig): EnvelopeProvider {
  if (config.envelope?.provider) {
    return config.envelope.provider;
  }
  if (config.kekSecret) {
    return 'local';
  }
  return 'memory';
}

export function createEnvelopeAdapter(config: IServerConfig): {
  adapter: KmsEnvelopeAdapter;
  provider: EnvelopeProvider;
} {
  const provider = resolveEnvelopeProvider(config);

  if (provider === 'memory') {
    return { adapter: new InMemoryEnvelopeAdapter(), provider };
  }

  if (provider === 'local') {
    if (!config.kekSecret) {
      throw new Error('ENVELOPE_PROVIDER=local requires KEK_SECRET.');
    }
    return { adapter: new AesGcmEnvelopeAdapter(config.kekSecret), provider };
  }

  if (provider === 'gcp-kms') {
    const keyName = String(config.gcpKms?.keyName || '').trim();
    if (!keyName) {
      throw new Error('ENVELOPE_PROVIDER=gcp-kms requires GCP_KMS_KEY_NAME.');
    }
    return { adapter: new CloudKmsEnvelopeAdapter(keyName), provider };
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
