import { ManageAsset } from './manageAsset';

export class ManageAssetArtifact extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('artifact', options);
  }

  public async upsertArtifact(mspId: string, artifactId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'UpsertArtifact', artifactId, JSON.stringify(payload));
  }
}

export const manageAssetArtifact = new ManageAssetArtifact();
