// src/adapters/BlockchainAdapterMem.ts

import { IBlockchainAdapter } from './IBlockchainAdapter';
import type { FhirCidVersionMapping } from '../utils/fhir-versioning';

/**
 * An in-memory mock implementation of the IBlockchainAdapter for testing and local development.
 * It simulates a blockchain ledger using a simple Map.
 */
export class BlockchainAdapterMem implements IBlockchainAdapter {
  private ledger: Map<string, string>;
  private consentAccessBundles: Map<string, Record<string, unknown>>;

  constructor() {
    // Pre-populate the mock ledger with some test data
    this.ledger = new Map<string, string>();
    this.consentAccessBundles = new Map<string, Record<string, unknown>>();
  }

  public async readSubjectIdentifierPayloads(
    assetIds: string[],
    _channel: string,
    _chaincode: string,
  ): Promise<(unknown | undefined)[]> {
    return assetIds.map((assetId) => {
      const indexProviderDid = this.ledger.get(assetId);
      return indexProviderDid ? { indexProviderDid } : undefined;
    });
  }

  public async registerCidVersionMappings(
    mappings: FhirCidVersionMapping[],
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }> {
    // This memory adapter acknowledges all mappings without persistent blockchain effects.
    // Production adapters can write these mappings on-chain.
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: mappings.length,
      txId: `mem-tx-${Date.now()}`,
    };
  }

  public async registerConsentAccessBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
    chaincode: string;
  }): Promise<{ accepted: number; txId?: string }> {
    this.consentAccessBundles.set(params.assetId, params.payload);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: Array.isArray(params.payload?.data) ? params.payload.data.length : 0,
      txId: `mem-consentaccess-${Date.now()}`,
    };
  }

  public async registerArtifactBundle(params: {
    assetId: string;
    payload: Record<string, unknown>;
    channel: string;
  }): Promise<{ accepted: number; txId?: string }> {
    this.consentAccessBundles.set(params.assetId, params.payload);
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      accepted: 1,
      txId: `mem-artifact-${Date.now()}`,
    };
  }

  // Helper method for tests to populate the ledger
  public addMapping(hash: string, did: string) {
    this.ledger.set(hash, did);
  }

  public getConsentAccessBundle(assetId: string): Record<string, unknown> | undefined {
    return this.consentAccessBundles.get(assetId);
  }
}
