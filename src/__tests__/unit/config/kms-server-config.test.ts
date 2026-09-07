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
      KMS_PROVIDER: 'aws',
      KMS_REGION: 'eu-west-1',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_CIPHERTEXT: 'kms-ciphertext',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    };
    resetServerConfig();

    const config = getConfig();

    expect(config.kms).toEqual({
      provider: 'aws',
      region: 'eu-west-1',
      keyId: 'alias/gw-production',
      runtimeKekCiphertext: 'kms-ciphertext',
      runtimeKekId: 'gw-production',
    });
  });

  it('does not consume AWS_REGION as a KMS_REGION fallback', () => {
    process.env = {
      ...originalEnv,
      KMS_PROVIDER: 'aws',
      AWS_REGION: 'eu-west-1',
    };
    resetServerConfig();

    expect(getConfig().kms).toMatchObject({ provider: 'aws', region: undefined });
  });
});
