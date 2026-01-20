// src/blockchain/fabric/v3/manageCredential.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

export class ManageAssetCredential extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('credential', options);
  }
}

export const manageAssetCredential = new ManageAssetCredential();
