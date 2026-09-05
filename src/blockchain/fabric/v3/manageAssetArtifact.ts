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

  public async upsertArtifactWithTransactionId(
    mspId: string,
    artifactId: string,
    payload: object,
  ): Promise<{ result: object; transactionId: string }> {
    return this.submitWithTransactionId(mspId, 'UpsertArtifact', artifactId, JSON.stringify(payload));
  }

  /**
   * Upserts every CID-keyed artifact in one primary-document data[] transaction.
   * Each item may carry only sanitized tags and opaque relationship/ownership
   * hashes alongside its CID; channel and contract remain manager-owned.
   */
  public async upsertArtifactsWithTransactionId(
    mspId: string,
    payload: object,
  ): Promise<{ result: object; transactionId: string }> {
    return this.submitWithTransactionId(mspId, 'UpsertArtifacts', JSON.stringify(payload));
  }
}

export const manageAssetArtifact = new ManageAssetArtifact();
