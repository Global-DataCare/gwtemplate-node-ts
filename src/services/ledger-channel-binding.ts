import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { fetchChannelGenesisSha256 } from '../blockchain/fabric/v3/channel-genesis';
import { getEnvSectionId } from '../utils/section-env';

export type LedgerChannelBinding = Readonly<{
  channel: string;
  genesisSha256: string;
}>;

export type FetchGenesisSha256 = (mspId: string, channel: string) => Promise<string>;

export function parseExpectedChannelBindings(value: string | undefined): LedgerChannelBinding[] {
  const entries = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error('LEDGER_CHANNEL_GENESIS_SHA256 must define at least one channel fingerprint.');
  }
  const seen = new Set<string>();
  return entries.map((entry) => {
    const separator = entry.indexOf('=');
    const channel = entry.slice(0, separator).trim();
    const genesisSha256 = entry.slice(separator + 1).trim().toLowerCase();
    if (separator < 1 || !/^[a-z0-9][a-z0-9.-]*$/.test(channel)) {
      throw new Error(`Invalid Fabric channel binding: ${entry}`);
    }
    if (!/^[a-f0-9]{64}$/.test(genesisSha256)) {
      throw new Error(`Invalid SHA-256 fingerprint for Fabric channel ${channel}.`);
    }
    if (seen.has(channel)) throw new Error(`Duplicate Fabric channel binding: ${channel}.`);
    seen.add(channel);
    return { channel, genesisSha256 };
  });
}

/**
 * Verifies every configured channel against its real block-zero fingerprint,
 * then persists a public binding in the scoped host vault. Existing bindings
 * are immutable: a mismatch fails startup before business writes are enabled.
 */
export async function verifyAndPersistLedgerChannelBindings(params: {
  vaultRepository: IVaultRepository;
  hostCollectionName: string;
  mspId: string;
  expected: LedgerChannelBinding[];
  fetchGenesisSha256?: FetchGenesisSha256;
}): Promise<void> {
  const fetchGenesis = params.fetchGenesisSha256 || fetchChannelGenesisSha256;
  const sectionId = getEnvSectionId('ledger-channel-bindings');
  for (const expected of params.expected) {
    const observed = (await fetchGenesis(params.mspId, expected.channel)).toLowerCase();
    if (observed !== expected.genesisSha256) {
      throw new Error(`Fabric genesis mismatch for channel ${expected.channel}.`);
    }

    const existing = await params.vaultRepository.get<any>(
      params.hostCollectionName,
      expected.channel,
      sectionId,
    );
    const persistedHash = String(existing?.content?.genesisSha256 || '').toLowerCase();
    if (persistedHash && persistedHash !== observed) {
      throw new Error(`Persisted Fabric genesis mismatch for channel ${expected.channel}.`);
    }
    if (!persistedHash) {
      await params.vaultRepository.put(params.hostCollectionName, [{
        id: expected.channel,
        status: 'active',
        sequence: 0,
        content: {
          channel: expected.channel,
          genesisSha256: observed,
          verifiedAt: new Date().toISOString(),
        },
      } as any], sectionId);
    }
  }
}
