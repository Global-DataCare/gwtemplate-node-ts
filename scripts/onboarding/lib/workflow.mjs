import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROLES = new Set(['authority', 'host', 'platform', 'status']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredPath(value, label) {
  return resolve(requiredString(value, label));
}

/**
 * Validates the operator-owned onboarding manifest without reading any secret.
 *
 * The manifest deliberately separates the Root/Fabric-CA authority, host and
 * platform reconciler roles. A shared staging cluster is allowed, but a
 * production manifest must declare independent infrastructure.
 */
export function validateOnboardingManifest(manifest) {
  if (manifest?.specVersion !== 'gdc.fabric.host-onboarding-assistant/v1') {
    throw new Error('Unsupported onboarding manifest specVersion.');
  }
  const environment = requiredString(manifest.environment, 'manifest.environment');
  if (!['local', 'staging', 'production'].includes(environment)) {
    throw new Error('manifest.environment must be local, staging or production.');
  }
  if (typeof manifest.sharedInfrastructure !== 'boolean') {
    throw new Error('manifest.sharedInfrastructure must be boolean.');
  }
  if (environment === 'production' && manifest.sharedInfrastructure) {
    throw new Error('Production onboarding cannot declare sharedInfrastructure=true.');
  }

  const inputs = manifest.inputs || {};
  const authority = manifest.authority || {};
  const host = manifest.host || {};
  const platform = manifest.platform || {};
  return {
    specVersion: manifest.specVersion,
    environment,
    sharedInfrastructure: manifest.sharedInfrastructure,
    inputs: {
      request: requiredPath(inputs.request, 'manifest.inputs.request'),
      decision: requiredPath(inputs.decision, 'manifest.inputs.decision'),
      controllerDidDocument: requiredPath(
        inputs.controllerDidDocument,
        'manifest.inputs.controllerDidDocument',
      ),
      icaDidDocument: requiredPath(inputs.icaDidDocument, 'manifest.inputs.icaDidDocument'),
      inventory: requiredPath(inputs.inventory, 'manifest.inputs.inventory'),
      identityJwks: requiredPath(inputs.identityJwks, 'manifest.inputs.identityJwks'),
    },
    authority: {
      caUrl: requiredString(authority.caUrl, 'manifest.authority.caUrl'),
      caAdminHome: requiredPath(authority.caAdminHome, 'manifest.authority.caAdminHome'),
      caTlsCert: authority.caTlsCert
        ? requiredPath(authority.caTlsCert, 'manifest.authority.caTlsCert')
        : undefined,
      authorizationOutput: requiredPath(
        authority.authorizationOutput,
        'manifest.authority.authorizationOutput',
      ),
      enrollmentGrantOutput: requiredPath(
        authority.enrollmentGrantOutput,
        'manifest.authority.enrollmentGrantOutput',
      ),
    },
    host: {
      peerDns: requiredString(host.peerDns, 'manifest.host.peerDns'),
      mspOutputDir: requiredPath(host.mspOutputDir, 'manifest.host.mspOutputDir'),
      caTlsCert: host.caTlsCert
        ? requiredPath(host.caTlsCert, 'manifest.host.caTlsCert')
        : undefined,
    },
    platform: {
      driver: requiredPath(platform.driver, 'manifest.platform.driver'),
      commandMap: requiredPath(platform.commandMap, 'manifest.platform.commandMap'),
      state: requiredPath(platform.state, 'manifest.platform.state'),
      audit: requiredPath(platform.audit, 'manifest.platform.audit'),
    },
  };
}

export function parseAssistantArgs(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') result.manifest = argv[++index];
    else if (arg === '--role') result.role = argv[++index];
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--confirm-request') result.confirmRequest = argv[++index];
    else throw new Error(`Unknown argument "${arg}".`);
  }
  if (!result.manifest) throw new Error('--manifest is required.');
  if (!ROLES.has(result.role)) {
    throw new Error('--role must be authority, host, platform or status.');
  }
  if (result.apply && result.role === 'status') {
    throw new Error('--apply is not valid with --role status.');
  }
  return result;
}

export function buildRolePlan(manifest, role) {
  if (role === 'authority') {
    return [
      manifest.environment === 'production'
        ? 'Verify the controller decision, current operator token and mandatory HostingServiceCredential.'
        : 'Verify the controller approval and current operator token; verify HostingServiceCredential when supplied.',
      'Register a bounded two-use Fabric CA enrollment identity.',
      'Write the enrollment grant with mode 0600; never print its secret.',
    ];
  }
  if (role === 'host') {
    return [
      'Read the bounded enrollment grant on the host.',
      'Generate the peer MSP and TLS private keys plus CSRs locally.',
      'Keep private keys inside the host output directory; receive certificates only.',
    ];
  }
  if (role === 'platform') {
    return [
      'Verify the same signed governance decision and compute the exact plan.',
      'Reconcile the host peer runtime before joining only the approved channels.',
      'Approve exact chaincode packages locally; only the governance executor commits.',
      'Persist resumable state and append-only audit evidence.',
    ];
  }
  return [
    `Environment: ${manifest.environment}`,
    `Shared infrastructure: ${manifest.sharedInfrastructure ? 'yes (staging only)' : 'no'}`,
    'Inspect authorization, enrollment and reconciliation artifacts without reading secrets.',
  ];
}

export async function readRequestId(requestPath) {
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const requestId = request?.governanceDecision?.decision?.requestId;
  return requiredString(requestId, 'request.governanceDecision.decision.requestId');
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
