// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// 1) GW submits one sanitized resource-evidence data[]; 2) the
// Fabric adapter uses one batch transaction that keys every individual asset by
// its CID; 3) the exact Fabric tx id and accepted resource count return to the
// caller. Authorization invariant: MSP identity and channel remain adapter-owned.
// Persistence invariant: no fullUrl, clinical payload or raw identity enters
// the ledger asset; authorship and ownership survive only as hashed links.
// TDD contract: make this green only with a real transaction-id boundary.
import { jest } from '@jest/globals';
import { BlockchainAdapterFabric } from '../../../adapters/BlockchainAdapterFabric';
import { ManageAssetArtifact } from '../../../blockchain/fabric/v3/manageAssetArtifact';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_HEALTHCARE_JURISDICTION,
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { buildFhirLedgerProvenance } from '../../../utils/fhir-versioning';

describe('Fabric clinical artifact evidence boundary', () => {
  test('returns one transaction id for individual CID assets submitted in one data array', async () => {
    const transactionId = EXAMPLE_OBSERVATION_PANEL_IDENTIFIER;
    const submit = jest.spyOn(ManageAssetArtifact.prototype, 'upsertArtifactsWithTransactionId')
      .mockResolvedValue({ result: {}, transactionId });
    const ledgerProvenance = buildFhirLedgerProvenance({
      claims: {
        'Composition.author': EXAMPLE_PROVIDER_ORGANIZATION_DID,
        'Composition.attester': EXAMPLE_PROFESSIONAL_DID,
        'Composition.subject': EXAMPLE_OBSERVATION_IDENTIFIER,
      },
      sender: EXAMPLE_PROFESSIONAL_DID,
      submitter: EXAMPLE_PROFESSIONAL_DID,
    });
    const evidence = [EXAMPLE_OBSERVATION_IDENTIFIER, EXAMPLE_OBSERVATION_PANEL_IDENTIFIER]
      .map((resourceId) => ({
        resourceType: ResourceTypesFhirR4.Observation,
        resourceId,
        cid: resourceId,
        versionId: resourceId,
        tags: [{ id: 'Observation[0].code', system: 'http://loinc.org', code: '85354-9' }],
        ...ledgerProvenance,
      }));

    try {
      const result = await new BlockchainAdapterFabric().registerCidVersionMappings(
        evidence.map((item) => ({ ...item, fullUrl: `urn:uuid:${item.resourceId}` })) as any,
        `${Sector.HEALTH_CARE}-${EXAMPLE_HEALTHCARE_JURISDICTION.toLowerCase()}`,
        'artifact-sc',
      );

      expect(result).toEqual({ accepted: evidence.length, txId: transactionId });
      expect(submit).toHaveBeenCalledWith(
        expect.any(String),
        {
          data: evidence.map((resource) => ({
            type: resource.resourceType,
            id: resource.cid,
            resource: {
              resourceType: resource.resourceType,
              meta: { versionId: resource.versionId, tag: resource.tags },
            },
            relationships: resource.relationships,
            ownerships: resource.ownerships,
          })),
        },
      );
    } finally {
      submit.mockRestore();
    }
  });
});
