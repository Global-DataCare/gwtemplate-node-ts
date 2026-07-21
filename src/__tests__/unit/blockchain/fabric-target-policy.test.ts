import {
  assertFabricChannelAllowed,
  assertFabricTargetAllowed,
  assertFabricTargetPolicyCoversBindings,
  parseFabricTargetPolicy,
} from '../../../blockchain/fabric/v3/fabric-target-policy';
import { ManageAsset } from '../../../blockchain/fabric/v3/manageAsset';

describe('scoped Fabric target policy', () => {
  const policy = parseFabricTargetPolicy(
    'identity=credential-sc|organization-sc;health-care-eu=consentaccess-sc|artifact-sc',
  );

  test('parses a channel and chaincode allowlist', () => {
    expect([...policy.get('identity')!]).toEqual(['credential-sc', 'organization-sc']);
    expect([...policy.get('health-care-eu')!]).toEqual(['consentaccess-sc', 'artifact-sc']);
  });

  test('rejects malformed and duplicate targets', () => {
    expect(() => parseFabricTargetPolicy(undefined)).toThrow(/at least one/);
    expect(() => parseFabricTargetPolicy('identity=')).toThrow(/Invalid/);
    expect(() => parseFabricTargetPolicy('identity=a;identity=b')).toThrow(/Duplicate/);
  });

  test('requires an exact channel match with genesis bindings', () => {
    expect(() => assertFabricTargetPolicyCoversBindings([
      { channel: 'identity', genesisSha256: 'a'.repeat(64) },
    ], policy)).toThrow(/unbound channel health-care-eu/);

    expect(() => assertFabricTargetPolicyCoversBindings([
      { channel: 'identity', genesisSha256: 'a'.repeat(64) },
      { channel: 'animal-pet-eu', genesisSha256: 'b'.repeat(64) },
    ], policy)).toThrow(/Missing Fabric chaincode allowlist/);
  });

  test('fails closed for channels and chaincodes outside the policy', () => {
    expect(() => assertFabricChannelAllowed('animal-pet-eu', policy)).toThrow(/not allowed/);
    expect(() => assertFabricTargetAllowed('identity', 'artifact-sc', policy)).toThrow(/not allowed/);
    expect(() => assertFabricTargetAllowed('identity', 'credential-sc', policy)).not.toThrow();
  });

  test('the shared contract boundary rejects an unbound request channel before connecting', async () => {
    const previous = {
      storageLayout: process.env.STORAGE_LAYOUT,
      deploymentEnv: process.env.DEPLOYMENT_ENV,
      networkMode: process.env.NETWORK_MODE,
      hostStorageScope: process.env.HOST_STORAGE_SCOPE,
      allowlist: process.env.LEDGER_CHANNEL_CHAINCODE_ALLOWLIST,
    };
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'accuro';
    process.env.LEDGER_CHANNEL_CHAINCODE_ALLOWLIST = 'identity=credential-sc';
    try {
      const manager = new ManageAsset('credential', {
        channelName: 'production-identity',
        chaincodeName: 'credential-sc',
      });
      await expect(manager.read('HOSTMSP', 'credential-1')).rejects.toThrow(/channel is not allowed/);
    } finally {
      for (const [key, value] of Object.entries({
        STORAGE_LAYOUT: previous.storageLayout,
        DEPLOYMENT_ENV: previous.deploymentEnv,
        NETWORK_MODE: previous.networkMode,
        HOST_STORAGE_SCOPE: previous.hostStorageScope,
        LEDGER_CHANNEL_CHAINCODE_ALLOWLIST: previous.allowlist,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
