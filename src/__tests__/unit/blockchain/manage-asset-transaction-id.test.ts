// Flow contract: 1) the gateway creates one proposal for the requested batch;
// 2) the endorsed Fabric transaction exposes its id before submit; 3) GW returns
// that exact id with the decoded chaincode result. Authorization invariant: the
// Gateway derives the endorsers from the committed chaincode policy instead of
// a client-side organization override. Persistence invariant: exposing the
// receipt must not cause a second submit.
import { describe, expect, jest, test } from '@jest/globals';
import { ManageAsset } from '../../../blockchain/fabric/v3/manageAsset';
import {
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';

describe('ManageAsset Fabric transaction receipt', () => {
  test('returns the transaction id from the same submitted proposal', async () => {
    const getResult = jest.fn(() => Buffer.from(JSON.stringify({
      id: EXAMPLE_OBSERVATION_IDENTIFIER,
    })));
    const submit = jest.fn(async () => undefined);
    const getTransactionId = jest.fn(() => EXAMPLE_OBSERVATION_PANEL_IDENTIFIER);
    const endorse = jest.fn(async () => ({ getResult, getTransactionId, submit }));
    const newProposal = jest.fn(() => ({ endorse }));
    const manager = new ManageAsset('artifact');
    jest.spyOn(manager as any, 'withContract').mockImplementation(async (_mspId: string, handler: any) =>
      handler({ contract: { newProposal } }));

    const receipt = await manager.submitWithTransactionId(
      EXAMPLE_OBSERVATION_IDENTIFIER,
      'UpsertArtifacts',
      JSON.stringify({ data: [] }),
    );

    expect(receipt).toEqual({
      result: { id: EXAMPLE_OBSERVATION_IDENTIFIER },
      transactionId: EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
    });
    expect(newProposal).toHaveBeenCalledWith('UpsertArtifacts', {
      arguments: [JSON.stringify({ data: [] })],
    });
    expect(getTransactionId).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(getResult).toHaveBeenCalledTimes(1);
  });
});
