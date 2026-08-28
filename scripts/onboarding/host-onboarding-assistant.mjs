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
  log('1/2 Verifying governance and host VC evidence.');
  const authorization = await run(process.execPath, [
    'scripts/enrollment/authorize-host-enrollment.mjs',
    '--request', manifest.inputs.request,
    '--controller-did-document', manifest.inputs.controllerDidDocument,
    '--ica-did-document', manifest.inputs.icaDidDocument,
    '--inventory', manifest.inputs.inventory,
    '--identity-jwks', manifest.inputs.identityJwks,
  ], { capture: true, label: 'host enrollment authorization' });
  await writePrivateJson(manifest.authority.authorizationOutput, authorization);

  log('2/2 Registering a bounded Fabric CA enrollment identity.');
  await run('bash', ['scripts/enrollment/register-host-enrollment.sh'], {
    label: 'Fabric CA registration',
    env: {
      AUTHORIZATION_JSON: manifest.authority.authorizationOutput,
      CA_URL: manifest.authority.caUrl,
      CA_ADMIN_HOME: manifest.authority.caAdminHome,
      ENROLLMENT_OUTPUT_FILE: manifest.authority.enrollmentGrantOutput,
      ...(manifest.authority.caTlsCert ? { CA_TLS_CERT: manifest.authority.caTlsCert } : {}),
    },
  });
  log('Authority phase complete. Transfer only the mode-0600 enrollment grant over an approved secure channel.');
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
  log('Host phase complete. Keep the private MSP/TLS material in host custody.');
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
    ['enrollment grant', manifest.authority.enrollmentGrantOutput],
    ['host MSP/TLS', manifest.host.mspOutputDir],
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
