// src/adapters/IBlockchainAdapter.ts

/**
 * Defines the standardized interface for interacting with a blockchain network
 * for the purpose of identity discovery. This allows the application's business logic
 * to be decoupled from the specific blockchain technology (e.g., Fabric, Ethereum).
 */
export interface IBlockchainAdapter {
  /** Reads strict provider-only values from the canonical subject identifier contract. */
  readSubjectIdentifierPayloads(
    assetIds: string[],
    channel: string,
    chaincode: string,
  ): Promise<(unknown | undefined)[]>;

  /**
   * Optional write path for registering content-addressed FHIR version identifiers.
   * `resource.id` remains UUID; `versionId` can carry a CID/multihash for traceability.
   *
   * Implementations can persist these mappings on-chain for audit/discovery.
   * Provenance crosses this boundary only as opaque relationship/ownership
   * hashes; raw FHIR references and claims remain confidential.
   */
  registerCidVersionMappings?(
    mappings: Array<{
      cid: string;
      versionId: string;
      resourceType?: string;
      resourceId?: string;
      tags?: Array<{
        id: string;
        system?: string;
        code?: string;
        version?: string;
        userSelected?: boolean;
      }>;
      relationships?: Partial<Record<
        'author' | 'attester' | 'custodian' | 'sender' | 'submitter' | 'signingKey',
        string[]
      >>;
      ownerships?: string[];
    }>,
    channel: string,
    chaincode: string,
  ): Promise<{ accepted: number; txId?: string }>;

  /**
   * Optional write path for registering one content-addressed artifact payload
   * on-chain.
   */
  registerArtifactBundle?(
    params: {
      assetId: string;
      payload: Record<string, unknown>;
      channel: string;
    },
  ): Promise<{ accepted: number; txId?: string }>;

  /**
   * Optional write path for registering one sanitized consent-access rule on-chain.
   *
   * The payload still uses the shared JSON:API-style primary-document contract
   * with mandatory `data[]`, but GW CORE now submits one atomic rule per call:
   * - `assetId = data[0].id = CIDv1(SHA3-384(canonicalRuleId))`
   * - `payload.data.length = 1`
   */
  registerConsentAccessBundle?(
    params: {
      assetId: string;
      payload: Record<string, unknown>;
      channel: string;
      chaincode: string;
    },
  ): Promise<{ accepted: number; txId?: string }>;
}
