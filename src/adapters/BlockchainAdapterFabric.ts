// src/adapters/BlockchainAdapterFabric.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ManageAssetConsentAccess } from '../blockchain/fabric/v3/manageAssetConsentAccess';
import { ManageAssetArtifact } from '../blockchain/fabric/v3/manageAssetArtifact';
import type { FhirCidVersionMapping } from '../utils/fhir-versioning';
import type { IBlockchainAdapter } from './IBlockchainAdapter';
import { ManageAssetSubjectIdentifier } from '../blockchain/fabric/v3/manageAssetSubjectIdentifier';

type FabricBlockchainConfig = {
  mspId: string;
};

const DEFAULT_FABRIC_BLOCKCHAIN_CONFIG: FabricBlockchainConfig = {
  mspId: 'Host1MSP',
};

function loadFabricBlockchainConfig(): FabricBlockchainConfig {
  return {
    mspId:
      process.env.LEDGER_MSP_ID
      || process.env.LEDGER_FABRIC_MSP_ID
      || process.env.HLF_MSP_ID_HOST1
      || DEFAULT_FABRIC_BLOCKCHAIN_CONFIG.mspId,
  };
}

/**
 * Minimal Fabric-backed blockchain adapter for write paths that already have a
 * dedicated chaincode contract.
 *
 * Read-oriented discovery remains delegated elsewhere because consent-access
 * registration does not currently expose DID discovery semantics.
 */
export class BlockchainAdapterFabric implements IBlockchainAdapter {
  public async readSubjectIdentifierPayloads(
    assetIds: string[],
    channel: string,
    chaincode: string,
  ): Promise<(unknown | undefined)[]> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetSubjectIdentifier({ channelName: channel, chaincodeName: chaincode });
    return Promise.all(assetIds.map(async (assetId) => {
      try {
        const asset = await manager.read(config.mspId, assetId) as Record<string, unknown>;
        return { indexProviderDid: asset.indexProviderDid };
      } catch (error: any) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('does not exist') || message.includes('not found')) return undefined;
        throw error;
      }
    }));
  }

  public async registerCidVersionMappings(
    mappings: FhirCidVersionMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetArtifact({ chaincodeName: chaincode, channelName: channel });
    const data = mappings.map(({ cid, versionId, resourceType, tags, relationships, ownerships }) => ({
      type: resourceType || 'Basic',
      id: cid,
      resource: {
        resourceType: resourceType || 'Basic',
        meta: {
          versionId,
          ...(tags?.length ? { tag: tags } : {}),
        },
      },
      ...(relationships && Object.keys(relationships).length ? { relationships } : {}),
      ...(ownerships?.length ? { ownerships } : {}),
    }));
    const submitted = await manager.upsertArtifactsWithTransactionId(config.mspId, { data });
    return { accepted: data.length, txId: submitted.transactionId };
  }

  public async registerConsentAccessBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
    chaincode: string;
  }): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetConsentAccess({
      chaincodeName: params.chaincode,
      channelName: params.channel,
    });

    await manager.submit(
      config.mspId,
      'upsertConsentAccess',
      params.assetId,
      JSON.stringify(params.payload),
    );

    return {
      accepted: Array.isArray(params.payload?.data) ? params.payload.data.length : 0,
    };
  }

  public async registerArtifactBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
  }): Promise<{ accepted: number; txId?: string }> {
    const config = loadFabricBlockchainConfig();
    const manager = new ManageAssetArtifact({
      channelName: params.channel,
    });

    const submitted = await manager.upsertArtifactWithTransactionId(
      config.mspId,
      params.assetId,
      params.payload,
    );

    return {
      accepted: 1,
      txId: submitted.transactionId,
    };
  }
}
