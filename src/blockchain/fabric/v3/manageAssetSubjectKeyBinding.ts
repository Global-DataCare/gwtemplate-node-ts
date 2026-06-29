import { ManageAsset } from './manageAsset';

/**
 * Fabric gateway wrapper for `subjectkeybinding-sc`.
 */
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

  /**
   * Creates or updates the relationship between one subject and one key.
   */
  public async upsertSubjectKeyBinding(mspId: string, bindingId: string, payload: object): Promise<object> {
    return this.submit(mspId, 'UpsertSubjectKeyBinding', bindingId, JSON.stringify(payload));
  }
}

export const manageAssetSubjectKeyBinding = new ManageAssetSubjectKeyBinding();
