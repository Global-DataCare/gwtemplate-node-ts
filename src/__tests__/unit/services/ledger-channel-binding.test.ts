/**
 * Flow contract: scoped GW startup verifies every configured channel's real
 * genesis block before persisting or accepting an immutable ledger binding.
 */
import { parseExpectedChannelBindings, verifyAndPersistLedgerChannelBindings } from '../../../services/ledger-channel-binding';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('ledger channel binding', () => {
  test('parses an anonymous multi-channel binding map', () => {
    expect(parseExpectedChannelBindings(`identity=${HASH_A},sector-eu=${HASH_B}`)).toEqual([
      { channel: 'identity', genesisSha256: HASH_A },
      { channel: 'sector-eu', genesisSha256: HASH_B },
    ]);
  });

  test('rejects malformed, missing and duplicate bindings', () => {
    expect(() => parseExpectedChannelBindings(undefined)).toThrow(/at least one/);
    expect(() => parseExpectedChannelBindings('identity=bad')).toThrow(/SHA-256/);
    expect(() => parseExpectedChannelBindings(`identity=${HASH_A},identity=${HASH_A}`)).toThrow(/Duplicate/);
  });

  test('persists a verified first binding and accepts the same immutable binding', async () => {
    const get = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      content: { genesisSha256: HASH_A },
    });
    const put = jest.fn().mockResolvedValue(true);
    const vaultRepository = { get, put } as any;
    const fetchGenesisSha256 = jest.fn().mockResolvedValue(HASH_A);
    const params = {
      vaultRepository,
      hostCollectionName: 'scoped-host',
      mspId: 'HOSTMSP',
      expected: [{ channel: 'identity', genesisSha256: HASH_A }],
      fetchGenesisSha256,
    };

    await verifyAndPersistLedgerChannelBindings(params);
    await verifyAndPersistLedgerChannelBindings(params);

    expect(fetchGenesisSha256).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test('fails closed before persistence when the peer exposes another genesis', async () => {
    const vaultRepository = { get: jest.fn(), put: jest.fn() } as any;

    await expect(verifyAndPersistLedgerChannelBindings({
      vaultRepository,
      hostCollectionName: 'scoped-host',
      mspId: 'HOSTMSP',
      expected: [{ channel: 'identity', genesisSha256: HASH_A }],
      fetchGenesisSha256: jest.fn().mockResolvedValue(HASH_B),
    })).rejects.toThrow(/genesis mismatch/);
    expect(vaultRepository.get).not.toHaveBeenCalled();
    expect(vaultRepository.put).not.toHaveBeenCalled();
  });

  test('fails closed when the persisted binding differs', async () => {
    const vaultRepository = {
      get: jest.fn().mockResolvedValue({ content: { genesisSha256: HASH_B } }),
      put: jest.fn(),
    } as any;

    await expect(verifyAndPersistLedgerChannelBindings({
      vaultRepository,
      hostCollectionName: 'scoped-host',
      mspId: 'HOSTMSP',
      expected: [{ channel: 'identity', genesisSha256: HASH_A }],
      fetchGenesisSha256: jest.fn().mockResolvedValue(HASH_A),
    })).rejects.toThrow(/Persisted Fabric genesis mismatch/);
    expect(vaultRepository.put).not.toHaveBeenCalled();
  });
});
