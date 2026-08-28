#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../governance/lib/canonical-json.mjs';
import { validateDecision } from '../governance/lib/decision.mjs';
import {
  verifyControllerJws,
  verifyOperatorIdentityToken,
  verifyVcJwt,
} from '../governance/lib/jws.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--request') result.request = argv[++index];
    else if (name === '--controller-did-document') result.controllerDidDocument = argv[++index];
    else if (name === '--ica-did-document') result.icaDidDocument = argv[++index];
    else if (name === '--inventory') result.inventory = argv[++index];
    else if (name === '--identity-jwks') result.identityJwks = argv[++index];
    else throw new Error(`Unknown argument "${name}".`);
  }
  for (const required of [
    'request',
    'controllerDidDocument',
    'icaDidDocument',
    'inventory',
    'identityJwks',
  ]) {
    if (!result[required]) throw new Error(`--${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required.`);
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function validateHostRequest(request) {
  if (request?.specVersion !== 'gdc.fabric.host-enrollment/v1') {
    throw new Error('Unsupported host enrollment specVersion.');
  }
  const hostUrl = new URL(requiredString(request.hostUrl, 'request.hostUrl'));
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/'
    || hostUrl.search || hostUrl.hash) {
    throw new Error('request.hostUrl must be a host origin without credentials, path, query or fragment.');
  }
  const mspId = requiredString(request.mspId, 'request.mspId');
  const envelope = request.governanceDecision;
  if (!envelope?.decision || typeof envelope?.approval?.jws !== 'string'
    || typeof envelope?.authentication?.jwt !== 'string') {
    throw new Error('request.governanceDecision must contain decision, approval.jws and authentication.jwt.');
  }
  const changes = envelope.decision.changes || [];
  if (!changes.length || changes.some((change) =>
    change.operation !== 'admit-organization' || change.mspId !== mspId)) {
    throw new Error('Governance decision must admit exactly the requested host MSP.');
  }
  return { hostUrl, mspId, envelope };
}

function assertHostUrlPolicy(hostUrl, networkKind) {
  if (networkKind === 'local-network') {
    const localHostname = hostUrl.hostname === 'localhost' || hostUrl.hostname.endsWith('.localhost');
    if (!localHostname || !['http:', 'https:'].includes(hostUrl.protocol)) {
      throw new Error('local-network request.hostUrl must use localhost or a .localhost hostname.');
    }
    return;
  }
  if (hostUrl.protocol !== 'https:') {
    throw new Error(`${networkKind} request.hostUrl must be an HTTPS origin.`);
  }
}

export async function authorizeHostEnrollment(input) {
  const validated = validateHostRequest(input.request);
  const decisionVerification = validateDecision(
    validated.envelope.decision,
    input.inventory,
    input.now,
  );
  assertHostUrlPolicy(validated.hostUrl, decisionVerification.networkKind);
  verifyOperatorIdentityToken({
    jwt: validated.envelope.authentication.jwt,
    jwks: input.identityJwks,
    expected: validated.envelope.decision.operator,
    allowedAudiences: input.inventory.governance.identityAudiences,
    now: input.now,
  });
  await verifyControllerJws({
    jws: validated.envelope.approval.jws,
    payload: canonicalJson(validated.envelope.decision),
    didDocument: input.controllerDidDocument,
    controllerDid: decisionVerification.controllerDid,
    controllerKid: decisionVerification.controllerKid,
  });

  const credentialRequired = decisionVerification.networkKind === 'network';
  const credentialSupplied = Boolean(input.request.hostCredentialJwt);
  if (credentialRequired && !credentialSupplied) {
    throw new Error('Production network requires a HostingServiceCredential.');
  }

  let hostCredential;
  let vc;
  if (credentialSupplied) {
    const trustedIcaDids = input.inventory?.governance?.trustedIcaDids;
    if (!Array.isArray(trustedIcaDids) || !trustedIcaDids.length) {
      throw new Error('Reconciler inventory has no trustedIcaDids for Host credential verification.');
    }
    hostCredential = verifyVcJwt({
      jwt: input.request.hostCredentialJwt,
      didDocument: input.icaDidDocument,
      expectedIssuer: input.icaDidDocument?.id,
      now: input.now,
    });
    if (!trustedIcaDids.includes(hostCredential.payload.iss)) {
      throw new Error('Host credential issuer is not trusted by reconciler inventory.');
    }
    vc = hostCredential.payload.vc;
    const types = Array.isArray(vc?.type) ? vc.type : [];
    if (!types.includes('HostingServiceCredential')) {
      throw new Error('Host credential must contain HostingServiceCredential.');
    }
    const subjectId = requiredString(vc?.credentialSubject?.id, 'Host credential subject id');
    if (subjectId !== validated.hostUrl.origin || hostCredential.payload.sub !== subjectId) {
      throw new Error('Host credential subject must equal request.hostUrl and VC-JWT sub.');
    }
  }

  return {
    authorized: true,
    requestId: decisionVerification.requestId,
    decisionDigest: decisionVerification.digest,
    hostUrl: validated.hostUrl.origin,
    mspId: validated.mspId,
    networkKind: decisionVerification.networkKind,
    evidencePolicy: credentialSupplied
      ? 'hosting-service-credential'
      : 'controller-approval',
    ...(hostCredential ? {
      hostCredentialId: hostCredential.payload.jti || vc.id,
      hostCredentialIssuer: hostCredential.payload.iss,
    } : {}),
    peerTargets: [...new Set(
      validated.envelope.decision.changes.flatMap((change) => change.peerTargets || []),
    )],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [request, controllerDidDocument, icaDidDocument, inventory, identityJwks] =
    await Promise.all([
      readJson(options.request),
      readJson(options.controllerDidDocument),
      readJson(options.icaDidDocument),
      readJson(options.inventory),
      readJson(options.identityJwks),
    ]);
  const result = await authorizeHostEnrollment({
    request,
    controllerDidDocument,
    icaDidDocument,
    inventory,
    identityJwks,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`fabric-host-enrollment: ${error.message}\n`);
    process.exitCode = 1;
  });
}
