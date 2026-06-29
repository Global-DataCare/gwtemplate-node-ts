import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for `artifact-sc`.
 *
 * `upsertArtifact(...)` maps directly to the chaincode transaction
 * `UpsertArtifact`. The wrapper exists only to make caller intent explicit and
 * to keep the function name out of manager code.
 */
export class ManageAssetArtifact extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('artifact', options);
  }

  /**
   * Creates or updates one artifact asset keyed by hash/CID identity.
   */
  public async upsertArtifact(mspId: string, artifactId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'UpsertArtifact', artifactId, JSON.stringify(payload));
  }
}

export const manageAssetArtifact = new ManageAssetArtifact();
