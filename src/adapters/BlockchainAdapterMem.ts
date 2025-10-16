// src/adapters/BlockchainAdapterMem.ts

import { IBlockchainAdapter } from './IBlockchainAdapter';

/**
 * An in-memory mock implementation of the IBlockchainAdapter for testing and local development.
 * It simulates a blockchain ledger using a simple Map.
 */
export class BlockchainAdapterMem implements IBlockchainAdapter {
  private ledger: Map<string, string>;

  constructor() {
    // Pre-populate the mock ledger with some test data
    this.ledger = new Map<string, string>();
  }

  /**
   * Simulates querying the mock ledger for a batch of hashes.
   */
  public async discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]> {
    console.log(`[BlockchainAdapterMem] Querying channel "${channel}" on chaincode "${chaincode}" for ${hashes.length} hashes.`);
    
    const results = hashes.map(hash => this.ledger.get(hash));
    
    // Simulate a delay
    await new Promise(resolve => setTimeout(resolve, 50));

    return results;
  }

  // Helper method for tests to populate the ledger
  public addMapping(hash: string, did: string) {
    this.ledger.set(hash, did);
  }
}
