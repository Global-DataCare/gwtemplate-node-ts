import { ManageAsset } from './manageAsset';

export class ManageAssetSubjectKeyBinding extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('subjectKeyBinding', options);
  }

  protected override getReadFunction(): string {
    return 'readSubjectKeyBinding';
  }

  protected override getHistoryFunction(): string {
    return 'getSubjectKeyBindingHistory';
  }

  public async upsertSubjectKeyBinding(mspId: string, bindingId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'UpsertSubjectKeyBinding', bindingId, JSON.stringify(payload));
  }
}

export const manageAssetSubjectKeyBinding = new ManageAssetSubjectKeyBinding();
