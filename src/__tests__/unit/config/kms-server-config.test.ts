// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { getConfig, resetServerConfig } from '../../../config/server-config';

describe('provider-neutral KMS server configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    resetServerConfig();
  });

  it('accepts AWS KMS and maps the canonical KMS variables', () => {
    process.env = {
      ...originalEnv,
      ENVELOPE_PROVIDER: 'aws-kms',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_CIPHERTEXT: 'kms-ciphertext',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    };
    resetServerConfig();

    const config = getConfig();

    expect(config.envelope?.provider).toBe('aws-kms');
    expect(config.kms).toEqual({
      keyId: 'alias/gw-production',
      runtimeKekCiphertext: 'kms-ciphertext',
      runtimeKekId: 'gw-production',
    });
  });
});
