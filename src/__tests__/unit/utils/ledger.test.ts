import { resolveIdentityChannel } from '../../../utils/ledger';

describe('resolveIdentityChannel', () => {
  const originalNetworkMode = process.env.NETWORK_MODE;
  const originalIdentityChannelDefault = process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;

  afterEach(() => {
    if (originalNetworkMode === undefined) {
      delete process.env.NETWORK_MODE;
    } else {
      process.env.NETWORK_MODE = originalNetworkMode;
    }

    if (originalIdentityChannelDefault === undefined) {
      delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;
    } else {
      process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT = originalIdentityChannelDefault;
    }
  });

  it('returns the explicit identity channel override when configured', () => {
    process.env.NETWORK_MODE = 'local-network';
    process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT = 'identity-override';

    expect(resolveIdentityChannel('ES')).toBe('identity-override');
  });

  it('returns identity-local for local-network when no explicit override exists', () => {
    process.env.NETWORK_MODE = 'local-network';
    delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;

    expect(resolveIdentityChannel('ES')).toBe('identity-local');
  });

  it('uses global human identity outside local-network regardless of jurisdiction', () => {
    process.env.NETWORK_MODE = 'test-network';
    delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;

    expect(resolveIdentityChannel('ES')).toBe('identity-global');
    expect(resolveIdentityChannel('US')).toBe('identity-global');
  });
});
