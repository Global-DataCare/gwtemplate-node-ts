import { resolveStorageScope } from '../../../config/storage-layout';
import type { LedgerChannelBinding } from '../../../services/ledger-channel-binding';

export type FabricTargetPolicy = ReadonlyMap<string, ReadonlySet<string>>;

const TARGET_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Parses `channel=chaincode-a|chaincode-b;other=chaincode-c` into the runtime
 * Fabric target allowlist used by every scoped-v2 contract access.
 */
export function parseFabricTargetPolicy(value: string | undefined): FabricTargetPolicy {
  const entries = String(value || '').split(';').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error('LEDGER_CHANNEL_CHAINCODE_ALLOWLIST must define at least one channel target.');
  }
  const result = new Map<string, ReadonlySet<string>>();
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    const channel = entry.slice(0, separator).trim();
    const chaincodes = entry.slice(separator + 1).split('|').map((item) => item.trim()).filter(Boolean);
    if (separator < 1 || !TARGET_NAME.test(channel) || chaincodes.length === 0 || chaincodes.some((item) => !TARGET_NAME.test(item))) {
      throw new Error(`Invalid Fabric target allowlist entry: ${entry}`);
    }
    if (result.has(channel)) throw new Error(`Duplicate Fabric target channel: ${channel}.`);
    result.set(channel, new Set(chaincodes));
  }
  return result;
}

export function assertFabricTargetPolicyCoversBindings(
  bindings: LedgerChannelBinding[],
  policy: FabricTargetPolicy,
): void {
  const boundChannels = new Set(bindings.map(({ channel }) => channel));
  for (const channel of boundChannels) {
    if (!policy.has(channel)) throw new Error(`Missing Fabric chaincode allowlist for bound channel ${channel}.`);
  }
  for (const channel of policy.keys()) {
    if (!boundChannels.has(channel)) throw new Error(`Fabric target policy contains unbound channel ${channel}.`);
  }
}

export function resolveConfiguredFabricTargetPolicy(): FabricTargetPolicy | undefined {
  if (resolveStorageScope().layout !== 'scoped-v2') return undefined;
  return parseFabricTargetPolicy(process.env.LEDGER_CHANNEL_CHAINCODE_ALLOWLIST);
}

export function assertFabricChannelAllowed(channel: string, policy = resolveConfiguredFabricTargetPolicy()): void {
  if (policy && !policy.has(channel)) throw new Error(`Fabric channel is not allowed: ${channel}.`);
}

export function assertFabricTargetAllowed(
  channel: string,
  chaincode: string,
  policy = resolveConfiguredFabricTargetPolicy(),
): void {
  if (!policy) return;
  const chaincodes = policy.get(channel);
  if (!chaincodes) throw new Error(`Fabric channel is not allowed: ${channel}.`);
  if (!chaincodes.has(chaincode)) throw new Error(`Fabric chaincode ${chaincode} is not allowed on channel ${channel}.`);
}
