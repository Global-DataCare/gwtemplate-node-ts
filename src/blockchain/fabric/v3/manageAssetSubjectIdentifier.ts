import { ManageAsset } from './manageAsset';

/** Fabric gateway wrapper for the global provider-only subject identifier contract. */
export class ManageAssetSubjectIdentifier extends ManageAsset {
  constructor(options: { chaincodeName?: string; channelName: string }) {
    super('subjectIdentifier', {
      chaincodeName: options.chaincodeName || 'subjectidentifier-sc',
      channelName: options.channelName,
    });
  }
}
