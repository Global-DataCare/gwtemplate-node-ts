import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

function step(requestId, type, target, input) {
  const material = canonicalJson({ requestId, type, target, input });
  return {
    id: createHash('sha256').update(material).digest('hex'),
    type,
    target,
    input,
  };
}

/**
 * Builds the exact ordered convergence plan. It never broadens membership:
 * only peers and chaincodes named by the signed decision become steps.
 */
export function buildPlan(decision, inventory) {
  const network = inventory.networks[decision.network];
  const phases = {
    channels: [],
    memberships: [],
    grants: [],
    runtimes: [],
    peers: [],
    approvals: [],
    commits: [],
    revocations: [],
  };
  const committedDefinitions = new Set();
  const admittedPeerChannels = new Map();
  for (const change of decision.changes) {
    const common = {
      network: decision.network,
      channel: change.channel,
      mspId: change.mspId,
    };
    if (change.operation === 'ensure-channel') {
      phases.channels.push(step(decision.requestId, 'ensure-orderer-channel', network.ordererTarget, common));
    }
    if (change.operation === 'admit-organization') {
      phases.memberships.push(step(decision.requestId, 'ensure-application-msp', network.ordererTarget, {
        ...common,
        mspDefinitionSha256: change.mspDefinitionSha256,
      }));
      phases.grants.push(step(decision.requestId, 'ensure-channel-grants', network.ordererTarget, {
        ...common,
        grants: [...change.grants].sort(),
      }));
      for (const peerTarget of change.peerTargets) {
        const admitted = admittedPeerChannels.get(peerTarget) || {
          network: decision.network,
          mspId: change.mspId,
          channels: new Set(),
        };
        admitted.channels.add(change.channel);
        admittedPeerChannels.set(peerTarget, admitted);
        phases.peers.push(step(decision.requestId, 'ensure-peer-channel', peerTarget, common));
        for (const chaincode of change.chaincodes) {
          phases.approvals.push(step(decision.requestId, 'ensure-chaincode-approved', peerTarget, {
            ...common,
            ...chaincode,
          }));
        }
      }
      for (const chaincode of change.chaincodes) {
        const definitionKey = `${change.channel}:${chaincode.name}`;
        if (committedDefinitions.has(definitionKey)) continue;
        committedDefinitions.add(definitionKey);
        phases.commits.push(step(decision.requestId, 'ensure-chaincode-committed', network.ordererTarget, {
          ...common,
          governanceExecutorMspId: network.governanceExecutorMspId,
          ...chaincode,
        }));
      }
    }
    if (change.operation === 'revoke-organization') {
      phases.revocations.push(step(decision.requestId, 'remove-application-msp', network.ordererTarget, common));
    }
  }
  for (const [peerTarget, admitted] of admittedPeerChannels) {
    phases.runtimes.push(step(decision.requestId, 'ensure-peer-runtime', peerTarget, {
      network: admitted.network,
      mspId: admitted.mspId,
      channels: [...admitted.channels].sort(),
    }));
  }
  const steps = [
    ...phases.channels,
    ...phases.memberships,
    ...phases.grants,
    ...phases.runtimes,
    ...phases.peers,
    ...phases.approvals,
    ...phases.commits,
    ...phases.revocations,
  ];
  return {
    specVersion: 'gdc.fabric.reconciliation-plan/v1',
    requestId: decision.requestId,
    network: decision.network,
    steps,
    digest: createHash('sha256').update(canonicalJson(steps)).digest('hex'),
  };
}
