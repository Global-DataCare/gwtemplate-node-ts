import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.mjs';

const SPEC_VERSION = 'gdc.fabric.channel-governance/v1';
const OPERATIONS = new Set(['ensure-channel', 'admit-organization', 'revoke-organization']);
const GRANTS = new Set(['read', 'write']);
const NETWORK_KINDS = new Set(['local-network', 'test-network', 'network']);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MSP_ID = /^[A-Za-z][A-Za-z0-9.-]*MSP$/;

function assertExactKeys(value, allowed, label) {
  const extras = Object.keys(value || {}).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} contains unsupported properties: ${extras.join(', ')}.`);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseDate(value, label) {
  const text = requiredString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO date-time.`);
  return timestamp;
}

function assertSha256(value, label) {
  if (!SHA256_HEX.test(requiredString(value, label))) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest.`);
  }
}

/**
 * Validates the signed decision and binds every requested channel, MSP and
 * peer to operator-owned inventory. Request data can narrow approved state,
 * but it cannot invent infrastructure targets or authority.
 */
export function validateDecision(decision, inventory, now = Date.now()) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('decision must be an object.');
  }
  if (decision.specVersion !== SPEC_VERSION) {
    throw new Error(`decision.specVersion must be ${SPEC_VERSION}.`);
  }
  assertExactKeys(
    decision,
    ['specVersion', 'requestId', 'issuedAt', 'expiresAt', 'network', 'governance', 'operator', 'changes'],
    'decision',
  );
  if (inventory?.specVersion !== 'gdc.fabric.reconciler-inventory/v1') {
    throw new Error('Unsupported reconciler inventory specVersion.');
  }
  const requestId = requiredString(decision.requestId, 'decision.requestId');
  if (!/^urn:uuid:[0-9a-fA-F-]{36}$/.test(requestId)) {
    throw new Error('decision.requestId must be a UUID URN.');
  }
  const issuedAt = parseDate(decision.issuedAt, 'decision.issuedAt');
  const expiresAt = parseDate(decision.expiresAt, 'decision.expiresAt');
  if (issuedAt > now + 300_000) throw new Error('decision.issuedAt is in the future.');
  if (expiresAt <= now) throw new Error('decision has expired.');
  if (expiresAt <= issuedAt) throw new Error('decision.expiresAt must be after issuedAt.');

  const networkName = requiredString(decision.network, 'decision.network');
  const network = inventory?.networks?.[networkName];
  if (!network) throw new Error(`Unknown governed network "${networkName}".`);
  const networkKind = network.networkKind || 'network';
  if (!NETWORK_KINDS.has(networkKind)) {
    throw new Error(`Network "${networkName}" has unsupported networkKind "${networkKind}".`);
  }
  if (inventory.targets?.[network.ordererTarget]?.kind !== 'orderer') {
    throw new Error(`Network "${networkName}" has no valid orderer target.`);
  }
  const allowedChannels = new Set(network.channels || []);

  const governance = decision.governance || {};
  assertExactKeys(
    governance,
    ['tenantId', 'controllerDid', 'controllerKid', 'controllerEmail', 'hostAuthorizationSha256'],
    'decision.governance',
  );
  const tenantId = requiredString(governance.tenantId, 'decision.governance.tenantId');
  const controllerDid = requiredString(governance.controllerDid, 'decision.governance.controllerDid');
  const controllerKid = requiredString(governance.controllerKid, 'decision.governance.controllerKid');
  const controllerEmail = requiredString(governance.controllerEmail, 'decision.governance.controllerEmail').toLowerCase();
  assertSha256(governance.hostAuthorizationSha256, 'decision.governance.hostAuthorizationSha256');

  if (tenantId !== inventory?.governance?.tenantId) {
    throw new Error('Governance tenant does not match reconciler inventory.');
  }
  if (!(inventory?.governance?.controllerDids || []).includes(controllerDid)) {
    throw new Error('Controller DID is not authorized by reconciler inventory.');
  }
  const allowedEmails = (inventory?.governance?.controllerEmails || []).map((email) => String(email).toLowerCase());
  if (!allowedEmails.includes(controllerEmail)) {
    throw new Error('Controller email is not authorized by reconciler inventory.');
  }
  if (!controllerKid.startsWith(`${controllerDid}#`)) {
    throw new Error('Controller kid must be a verification method of controllerDid.');
  }

  const operator = decision.operator || {};
  assertExactKeys(
    operator,
    ['issuer', 'subject', 'email', 'tenantId', 'authenticatedAt'],
    'decision.operator',
  );
  if (requiredString(operator.tenantId, 'decision.operator.tenantId') !== tenantId) {
    throw new Error('Authenticated operator tenant does not match governance tenant.');
  }
  if (requiredString(operator.email, 'decision.operator.email').toLowerCase() !== controllerEmail) {
    throw new Error('Authenticated operator email does not match the signing controller.');
  }
  requiredString(operator.issuer, 'decision.operator.issuer');
  requiredString(operator.subject, 'decision.operator.subject');
  const authenticatedAt = parseDate(operator.authenticatedAt, 'decision.operator.authenticatedAt');
  if (authenticatedAt > issuedAt || issuedAt - authenticatedAt > 900_000) {
    throw new Error('Operator authentication must precede the decision by at most 15 minutes.');
  }
  if (!(inventory?.governance?.identityIssuers || []).includes(operator.issuer)) {
    throw new Error('Authenticated operator issuer is not trusted by reconciler inventory.');
  }

  if (!Array.isArray(decision.changes) || decision.changes.length === 0) {
    throw new Error('decision.changes must contain at least one change.');
  }
  const seenChanges = new Set();
  const chaincodeDefinitions = new Map();
  for (const [index, change] of decision.changes.entries()) {
    const prefix = `decision.changes[${index}]`;
    assertExactKeys(
      change,
      ['operation', 'channel', 'mspId', 'mspDefinitionSha256', 'peerTargets', 'grants', 'chaincodes'],
      prefix,
    );
    if (!OPERATIONS.has(change.operation)) throw new Error(`${prefix}.operation is unsupported.`);
    const channel = requiredString(change.channel, `${prefix}.channel`);
    if (!allowedChannels.has(channel)) throw new Error(`${prefix}.channel is not in governed inventory.`);
    const mspId = requiredString(change.mspId, `${prefix}.mspId`);
    if (!MSP_ID.test(mspId) || !network.msps?.[mspId]) {
      throw new Error(`${prefix}.mspId is not in governed network inventory.`);
    }
    const key = `${change.operation}:${channel}:${mspId}`;
    if (seenChanges.has(key)) throw new Error(`Duplicate governance change "${key}".`);
    seenChanges.add(key);

    if (change.operation === 'admit-organization') {
      assertSha256(change.mspDefinitionSha256, `${prefix}.mspDefinitionSha256`);
    }
    const peerTargets = Array.isArray(change.peerTargets) ? change.peerTargets : [];
    const allowedPeerTargets = new Set(network.msps[mspId].peerTargets || []);
    for (const target of peerTargets) {
      if (
        !allowedPeerTargets.has(target)
        || inventory.targets?.[target]?.kind !== 'peer'
        || inventory.targets?.[target]?.mspId !== mspId
      ) {
        throw new Error(`${prefix}.peerTargets contains unauthorized target "${target}".`);
      }
    }
    const grants = Array.isArray(change.grants) ? change.grants : [];
    if (new Set(grants).size !== grants.length || grants.some((grant) => !GRANTS.has(grant))) {
      throw new Error(`${prefix}.grants contains duplicates or unsupported grants.`);
    }
    if (change.operation === 'revoke-organization' && (peerTargets.length || grants.length || change.chaincodes?.length)) {
      throw new Error(`${prefix} revocation must not request peer joins, grants or chaincodes.`);
    }
    if (
      change.operation === 'ensure-channel'
      && (
        mspId !== network.governanceExecutorMspId
        || peerTargets.length
        || grants.length
        || change.chaincodes?.length
      )
    ) {
      throw new Error(`${prefix} channel creation must name only the governance executor MSP.`);
    }
    if (!Array.isArray(change.chaincodes)) throw new Error(`${prefix}.chaincodes must be an array.`);
    for (const [chaincodeIndex, chaincode] of change.chaincodes.entries()) {
      const ccPrefix = `${prefix}.chaincodes[${chaincodeIndex}]`;
      assertExactKeys(
        chaincode,
        ['name', 'version', 'sequence', 'packageId', 'endorsementPolicySha256'],
        ccPrefix,
      );
      requiredString(chaincode.name, `${ccPrefix}.name`);
      requiredString(chaincode.version, `${ccPrefix}.version`);
      requiredString(chaincode.packageId, `${ccPrefix}.packageId`);
      if (!Number.isSafeInteger(chaincode.sequence) || chaincode.sequence < 1) {
        throw new Error(`${ccPrefix}.sequence must be a positive integer.`);
      }
      assertSha256(chaincode.endorsementPolicySha256, `${ccPrefix}.endorsementPolicySha256`);
      const definitionKey = `${channel}:${chaincode.name}`;
      const definition = canonicalJson(chaincode);
      const previous = chaincodeDefinitions.get(definitionKey);
      if (previous && previous !== definition) {
        throw new Error(`Conflicting chaincode definition for "${definitionKey}".`);
      }
      chaincodeDefinitions.set(definitionKey, definition);
    }
  }
  return {
    requestId,
    controllerDid,
    controllerKid,
    networkName,
    network,
    networkKind,
    digest: createHash('sha256').update(canonicalJson(decision)).digest('hex'),
  };
}
