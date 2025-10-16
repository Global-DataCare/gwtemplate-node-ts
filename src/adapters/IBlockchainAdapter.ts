// src/adapters/IBlockchainAdapter.ts

/**
 * Defines the standardized interface for interacting with a blockchain network
 * for the purpose of identity discovery. This allows the application's business logic
 * to be decoupled from the specific blockchain technology (e.g., Fabric, Ethereum).
 */
export interface IBlockchainAdapter {
  /**
   * Queries the blockchain network to discover DIDs associated with a given list of hashes.
   * The returned array must maintain the same order as the input hashes.
   *
   * @param hashes An array of multibase-encoded multihashes to look up.
   * @param channel The name of the channel on the network (e.g., 'health-care-eu').
   * @param chaincode The name of the smart contract/chaincode to invoke (e.g., 'discovery-person').
   * @returns A promise that resolves to an array of the same length as the input. Each element
   *          is either the found 'did:web' string or undefined if not found.
   */
  discoverDidsByHashes(hashes: string[], channel: string, chaincode: string): Promise<(string | undefined)[]>;
}
