import { ManageAsset } from './manageAsset';

export class ManageAssetArtifactEvent extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('artifactEvent', options);
  }

  protected override getReadFunction(): string {
    return 'readArtifactEvent';
  }

  protected override getHistoryFunction(): string {
    return 'getArtifactEventHistory';
  }

  public async createArtifactEvent(mspId: string, eventId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'CreateArtifactEvent', eventId, JSON.stringify(payload));
  }
}

export const manageAssetArtifactEvent = new ManageAssetArtifactEvent();
