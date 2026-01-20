// src/blockchain/fabric/v3/manageCryptographicKey.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAsset } from './manageAsset';

export class ManageAssetCryptographicKey extends ManageAsset {
  constructor(options?: { chaincodeName?: string; channelName?: string }) {
    super('cryptographicKey', options);
  }
}

export const manageAssetCryptographicKey = new ManageAssetCryptographicKey();
