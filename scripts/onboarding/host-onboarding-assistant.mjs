#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildRolePlan,
  parseAssistantArgs,
  pathExists,
  readRequestId,
  validateOnboardingManifest,
} from './lib/workflow.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function log(message) {
  process.stderr.write(`[fabric-host-onboarding] ${message}\n`);
}

function run(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let stdout = '';
    if (options.capture) child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${options.label || executable} failed with exit code ${code}.`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function writePrivateJson(path, jsonText) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  JSON.parse(jsonText);
  await writeFile(temporary, jsonText.endsWith('\n') ? jsonText : `${jsonText}\n`, { mode: 0o600 });
  await rename(temporary, absolute);
}

async function applyAuthority(manifest) {
  log('1/4 Verifying governance and host VC evidence.');
  const authorization = await run(process.execPath, [
    'scripts/enrollment/authorize-host-enrollment.mjs',
    '--request', manifest.inputs.request,
    '--controller-did-document', manifest.inputs.controllerDidDocument,
    '--ica-did-document', manifest.inputs.icaDidDocument,
    '--inventory', manifest.inputs.inventory,
    '--identity-jwks', manifest.inputs.identityJwks,
  ], { capture: true, label: 'host enrollment authorization' });
  await writePrivateJson(manifest.authority.authorizationOutput, authorization);

  log('2/4 Provisioning the governed MSP administrator and public MSP definition.');
  await run('bash', ['scripts/enrollment/provision-governed-msp-admin.sh'], {
    label: 'governed MSP administrator provisioning',
    env: {
      AUTHORIZATION_JSON: manifest.authority.authorizationOutput,
      CA_URL: manifest.authority.caUrl,
      CA_NAME: manifest.authority.caName,
      CA_ADMIN_HOME: manifest.authority.caAdminHome,
      MSP_ADMIN_OUTPUT_DIR: manifest.authority.mspAdminOutputDir,
      MSP_PUBLIC_OUTPUT_DIR: manifest.authority.publicMspOutputDir,
      ...(manifest.authority.caTlsCert ? { CA_TLS_CERT: manifest.authority.caTlsCert } : {}),
    },
  });

  log('3/4 Registering a bounded Fabric CA peer enrollment identity.');
  await run('bash', ['scripts/enrollment/register-host-enrollment.sh'], {
    label: 'Fabric CA registration',
    env: {
      AUTHORIZATION_JSON: manifest.authority.authorizationOutput,
      CA_URL: manifest.authority.caUrl,
      CA_NAME: manifest.authority.caName,
      CA_ADMIN_HOME: manifest.authority.caAdminHome,
      ENROLLMENT_OUTPUT_FILE: manifest.authority.enrollmentGrantOutput,
      ...(manifest.authority.caTlsCert ? { CA_TLS_CERT: manifest.authority.caTlsCert } : {}),
    },
  });
  log('4/4 Registering a one-use GW Fabric client identity.');
  await run('bash', ['scripts/enrollment/register-host-client-enrollment.sh'], {
    label: 'Fabric CA GW client registration',
    env: {
      AUTHORIZATION_JSON: manifest.authority.authorizationOutput,
      CA_URL: manifest.authority.caUrl,
      CA_NAME: manifest.authority.caName,
      CA_ADMIN_HOME: manifest.authority.caAdminHome,
      CLIENT_ENROLLMENT_OUTPUT_FILE: manifest.authority.clientEnrollmentGrantOutput,
      ...(manifest.authority.caTlsCert ? { CA_TLS_CERT: manifest.authority.caTlsCert } : {}),
    },
  });
  log('Authority phase complete. Retain the MSP administrator; transfer only both mode-0600 host grants.');
}

async function applyHost(manifest) {
  log('Generating MSP and TLS keys locally. No private key will be downloaded.');
  await run('bash', ['scripts/enrollment/enroll-host-msp.sh'], {
    label: 'host-local Fabric enrollment',
    env: {
      ENROLLMENT_GRANT_FILE: manifest.authority.enrollmentGrantOutput,
      HOST_MSP_OUTPUT_DIR: manifest.host.mspOutputDir,
      HOST_PEER_DNS: manifest.host.peerDns,
      ...(manifest.host.caTlsCert ? { CA_TLS_CERT: manifest.host.caTlsCert } : {}),
    },
  });
  await run('bash', ['scripts/onboarding/package-host-runtime.sh'], {
    label: 'host runtime packaging',
    env: {
      HOST_IDENTITY_DIR: manifest.host.mspOutputDir,
      AUTHORIZATION_JSON: manifest.authority.authorizationOutput,
      ENROLLMENT_GRANT_FILE: manifest.authority.enrollmentGrantOutput,
      HOST_RUNTIME_OUTPUT_DIR: manifest.host.runtimeOutputDir,
    },
  });
  await run('bash', ['scripts/enrollment/enroll-host-client.sh'], {
    label: 'host-local GW Fabric client enrollment',
    env: {
      ENROLLMENT_GRANT_FILE: manifest.authority.clientEnrollmentGrantOutput,
      HOST_CLIENT_OUTPUT_DIR: manifest.host.gwClientOutputDir,
      ...(manifest.host.caTlsCert ? { CA_TLS_CERT: manifest.host.caTlsCert } : {}),
    },
  });
  await run('bash', ['scripts/onboarding/render-gw-fabric-env.sh'], {
    label: 'private GW Fabric environment rendering',
    env: {
      HOST_CLIENT_MSP_DIR: resolve(manifest.host.gwClientOutputDir, 'msp'),
      HOST_MSP_ID: JSON.parse(await readFile(manifest.authority.authorizationOutput, 'utf8')).mspId,
      HOST_PEER_ENDPOINT: manifest.host.peerEndpoint,
      HOST_PEER_TLS_CA: resolve(manifest.host.mspOutputDir, 'tls', 'ca.crt'),
      GW_FABRIC_ENV_OUTPUT: manifest.host.gwFabricEnvOutput,
    },
  });
  log('Host phase complete. Keep peer and GW client private identities plus sanitized runtime artifacts in host custody.');
}

async function runPlatform(manifest, apply) {
  log(apply
    ? 'Applying the verified, inventory-bounded reconciliation plan.'
    : 'Verifying inputs and rendering a read-only reconciliation plan.');
  await run(process.execPath, [
    'scripts/governance/reconcile.mjs',
    '--decision', manifest.inputs.decision,
    '--did-document', manifest.inputs.controllerDidDocument,
    '--inventory', manifest.inputs.inventory,
    '--identity-jwks', manifest.inputs.identityJwks,
    ...(apply ? [
      '--driver', manifest.platform.driver,
      '--state', manifest.platform.state,
      '--audit', manifest.platform.audit,
      '--apply',
    ] : []),
  ], {
    label: 'Fabric platform reconciliation',
    env: { FABRIC_RECONCILER_COMMAND_MAP: manifest.platform.commandMap },
  });
}

async function showStatus(manifest) {
  const entries = [
    ['authorization', manifest.authority.authorizationOutput],
    ['governed MSP administrator', manifest.authority.mspAdminOutputDir],
    ['public MSP definition', manifest.authority.publicMspOutputDir],
    ['enrollment grant', manifest.authority.enrollmentGrantOutput],
    ['GW client enrollment grant', manifest.authority.clientEnrollmentGrantOutput],
    ['host MSP/TLS', manifest.host.mspOutputDir],
    ['Helm runtime package', manifest.host.runtimeOutputDir],
    ['GW Fabric client environment', manifest.host.gwFabricEnvOutput],
    ['reconciler state', manifest.platform.state],
    ['audit log', manifest.platform.audit],
  ];
  for (const [label, path] of entries) {
    log(`${label}: ${(await pathExists(path)) ? 'present' : 'pending'} (${path})`);
  }
}

/**
 * Guides one role at a time through governed host admission.
 *
 * Plan is the default. Mutating authority, host or platform phases require
 * both `--apply` and the exact signed request ID via `--confirm-request`.
 * The assistant never logs enrollment secrets or reads host private keys.
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseAssistantArgs(argv);
  const manifest = validateOnboardingManifest(
    JSON.parse(await readFile(resolve(options.manifest), 'utf8')),
  );
  log(`${options.apply ? 'APPLY' : 'PLAN'} ${options.role} (${manifest.environment}).`);
  for (const [index, item] of buildRolePlan(manifest, options.role).entries()) {
    log(`${index + 1}. ${item}`);
  }
  if (options.role === 'status') return showStatus(manifest);
  if (!options.apply) {
    if (options.role === 'platform') await runPlatform(manifest, false);
    return;
  }

  const requestId = await readRequestId(manifest.inputs.request);
  if (options.confirmRequest !== requestId) {
    throw new Error(`--apply requires --confirm-request ${requestId}`);
  }
  if (options.role === 'authority') await applyAuthority(manifest);
  else if (options.role === 'host') await applyHost(manifest);
  else await runPlatform(manifest, true);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`fabric-host-onboarding: ${error.message}\n`);
    process.exitCode = 1;
  });
}
