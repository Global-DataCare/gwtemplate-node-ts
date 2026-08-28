#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const fabricDevnetRoot = resolve(
  process.env.FABRIC_DEVNET_ROOT || resolve(repoRoot, 'infra/fabric/local-network'),
);
const defaultEnvFile = resolve(repoRoot, '.env.local-fabric');
const baseEnvFile = resolve(process.env.LOCAL_DEMO_ENV_FILE || resolve(repoRoot, '.env.local-demo'));
const logsRoot = resolve(repoRoot, 'logs');
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const runLogDir = join(logsRoot, `local-fabric-stack-${runId}`);
const gwPidFile = resolve(repoRoot, '.local-fabric-gw.pid');

mkdirSync(runLogDir, { recursive: true });

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const config = {
  tenantId: args.tenantId || 'acme-id',
  envFile: resolve(repoRoot, args.envFile || '.env.local-fabric'),
  baseUrl: args.baseUrl || 'http://localhost:3000',
  hostJurisdiction: args.hostJurisdiction || 'eu',
  dataChannel: args.dataChannel || 'health-care-local',
  identityChannel: args.identityChannel || 'identity-local',
  bootstrapTenant: args.bootstrapTenant,
  bootstrapIndividual: args.bootstrapIndividual,
  deployChaincode: args.deployChaincode,
  startGw: args.startGw,
  restartGw: args.restartGw,
  prepareOnly: args.prepareOnly,
  fabricCaSource: process.env.LOCAL_FABRIC_CA_SOURCE || 'dev',
  dataspaceCaRootDir: process.env.DATASPACE_CA_ROOT_DIR,
  dataspaceCaIssuerDir: process.env.DATASPACE_CA_ISSUER_DIR,
};

const envFileValues = existsSync(config.envFile) ? parseSimpleEnv(readFileSync(config.envFile, 'utf8')) : {};
if (!args.baseUrl && envFileValues.BASE_URL) config.baseUrl = envFileValues.BASE_URL;
if (!args.hostJurisdiction && envFileValues.HOST_JURISDICTION) {
  config.hostJurisdiction = String(envFileValues.HOST_JURISDICTION).toLowerCase();
}

async function main() {
  requirePath(fabricDevnetRoot, 'Missing bundled Fabric local-network infrastructure');
  requirePath(baseEnvFile, 'Missing local demo base environment');
  if (!['dev', 'dataspace-ca'].includes(config.fabricCaSource)) {
    throw new Error('LOCAL_FABRIC_CA_SOURCE must be dev or dataspace-ca.');
  }

  await runStep('fabric-reset-devnet', {
    cwd: fabricDevnetRoot,
    command: 'bash',
    args: [
      '-lc',
      [
        "for container in $(docker ps -a --format '{{.ID}} {{.Names}}' | awk '$2 ~ /^dev-peer0-host/ {print $1}'); do docker rm -f \"$container\" >/dev/null 2>&1 || true; done",
        'docker compose down -v --remove-orphans || true',
        'for service in orderer peer0-host1 peer0-host2 fabric-tools fabric-ca-client ica root-ca; do docker rm -f "${GDC_CONTAINER_PREFIX:-gdc}-$service" >/dev/null 2>&1 || true; done; docker rm -f consentaccess-sc >/dev/null 2>&1 || true',
        'for attempt in $(seq 1 30); do remaining=false; for service in orderer peer0-host1 peer0-host2 fabric-tools fabric-ca-client ica root-ca; do docker container inspect "${GDC_CONTAINER_PREFIX:-gdc}-$service" >/dev/null 2>&1 && remaining=true; done; [ "$remaining" = false ] && break; [ "$attempt" != 30 ] || exit 1; sleep 1; done',
        'docker volume rm -f "${COMPOSE_PROJECT_NAME:-gdc-fabric-v3-devnet}_orderer-data" "${COMPOSE_PROJECT_NAME:-gdc-fabric-v3-devnet}_peer0-host1-data" "${COMPOSE_PROJECT_NAME:-gdc-fabric-v3-devnet}_peer0-host2-data" >/dev/null 2>&1 || true',
      ].join('; '),
    ],
  });

  if (config.fabricCaSource === 'dataspace-ca') {
    if (!config.dataspaceCaRootDir || !config.dataspaceCaIssuerDir) {
      throw new Error(
        'LOCAL_FABRIC_CA_SOURCE=dataspace-ca requires DATASPACE_CA_ROOT_DIR and DATASPACE_CA_ISSUER_DIR.',
      );
    }
    requirePath(resolve(config.dataspaceCaRootDir), 'Missing dataspace CA Root directory');
    requirePath(resolve(config.dataspaceCaIssuerDir), 'Missing dataspace CA issuer directory');
    await runStep('fabric-copy-dataspace-cas', {
      cwd: fabricDevnetRoot,
      command: 'bash',
      args: [
        './scripts/00-copy-dataspace-ca.sh',
        resolve(config.dataspaceCaRootDir),
        resolve(config.dataspaceCaIssuerDir),
      ],
    });
  } else {
    await runStep('fabric-copy-dev-cas', {
      cwd: fabricDevnetRoot,
      command: 'bash',
      args: ['./scripts/00-copy-dev-cas.sh'],
    });
  }
  await runStep('fabric-up-cas', {
    cwd: fabricDevnetRoot,
    command: 'bash',
    args: ['./scripts/01-up-cas.sh'],
  });
  await runStep('fabric-bootstrap-network', {
    cwd: fabricDevnetRoot,
    command: 'bash',
    args: ['./scripts/02-bootstrap-network.sh'],
    env: {
      HLF_DATA_CHANNEL_NAME: config.dataChannel,
      HLF_IDENTITY_CHANNEL_NAME: config.identityChannel,
      HLF_BOOTSTRAP_CHANNELS: `${config.identityChannel},${config.dataChannel}`,
    },
  });
  await runStep('fabric-generate-backend-env', {
    cwd: fabricDevnetRoot,
    command: 'bash',
    args: ['./scripts/04-generate-backend-env.sh'],
    env: {
      HLF_DATA_CHANNEL_NAME: config.dataChannel,
      HLF_IDENTITY_CHANNEL_NAME: config.identityChannel,
      HLF_BOOTSTRAP_CHANNELS: `${config.identityChannel},${config.dataChannel}`,
    },
  });

  await runStep('gw-prepare-local-fabric-env', {
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'prepare:local-fabric-env'],
    env: {
      CHANNEL_NAME: config.dataChannel,
      IDENTITY_CHANNEL_NAME: config.identityChannel,
      BOOTSTRAP_CHANNELS_VALUE: `${config.identityChannel},${config.dataChannel}`,
    },
  });

  if (config.deployChaincode) {
    await runStep('fabric-deploy-identity-chaincodes', {
      cwd: fabricDevnetRoot,
      command: 'bash',
      args: ['./scripts/05-deploy-identity-chaincodes.sh'],
      env: {
        GWTEMPLATE_DIR: repoRoot,
        CHANNEL_NAME: config.identityChannel,
        HLF_IDENTITY_CHANNEL_NAME: config.identityChannel,
      },
    });

    await runStep('fabric-deploy-consentaccess-chaincode', {
      cwd: repoRoot,
      command: 'bash',
      args: ['./chaincode/scripts/consentaccess-local-devnet.sh'],
      env: {
        CHANNEL_NAME: config.dataChannel,
        HLF_DATA_CHANNEL_NAME: config.dataChannel,
        FABRIC_TOOLS_CONTAINER: `${process.env.GDC_CONTAINER_PREFIX || 'gdc'}-fabric-tools`,
        DEVNET_NETWORK: process.env.DEVNET_NETWORK_NAME || 'gdc-fabric-v3-devnet',
      },
    });
  }

  if (config.prepareOnly) {
    console.log('\n[local-fabric-stack] local-network prepared without starting GW');
    console.log(`  env: ${config.envFile}`);
    console.log(`  data channel: ${config.dataChannel}`);
    console.log(`  identity channel: ${config.identityChannel}`);
    return;
  }

  if (config.restartGw) {
    await runStep('gw-stop-existing', {
      cwd: repoRoot,
      command: 'npm',
      args: ['run', 'local:close'],
    });
  }

  const hostPingUrl = buildHostPingUrl(config.baseUrl, config.hostJurisdiction);
  const gwReachable = await pingUrl(hostPingUrl, 1500);
  if (!gwReachable && config.startGw) {
    await startGatewayInBackground(config.envFile);
  }

  await waitForPing(hostPingUrl, 90_000);

  if (config.bootstrapTenant) {
    await runStep('gw-bootstrap-tenant', {
      cwd: repoRoot,
      command: 'npx',
      args: [
        'dotenv',
        '-e',
        config.envFile,
        '--',
        './scripts/bootstrap-single-tenant.sh',
      ],
      env: {
        TENANT_ID: config.tenantId,
      },
    });
  }

  if (config.bootstrapIndividual) {
    await runStep('gw-bootstrap-individual', {
      cwd: repoRoot,
      command: 'bash',
      args: [
        '-lc',
        `npx dotenv -e ${shellQuote(config.envFile)} -- bash ./scripts/demo-create-individual-organization.sh`,
      ],
      env: {
        TENANT_ID: config.tenantId,
      },
    });
  }

  printSummary(hostPingUrl);
}

function parseArgs(argv) {
  const result = {
    help: false,
    tenantId: undefined,
    envFile: undefined,
    baseUrl: undefined,
    hostJurisdiction: undefined,
    bootstrapTenant: true,
    bootstrapIndividual: false,
    deployChaincode: true,
    startGw: true,
    restartGw: false,
    prepareOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--tenant-id') result.tenantId = argv[++i];
    else if (arg === '--env-file') result.envFile = argv[++i];
    else if (arg === '--base-url') result.baseUrl = argv[++i];
    else if (arg === '--host-jurisdiction') result.hostJurisdiction = argv[++i];
    else if (arg === '--data-channel') result.dataChannel = argv[++i];
    else if (arg === '--identity-channel') result.identityChannel = argv[++i];
    else if (arg === '--no-bootstrap-tenant') result.bootstrapTenant = false;
    else if (arg === '--bootstrap-individual') result.bootstrapIndividual = true;
    else if (arg === '--no-deploy-chaincode') result.deployChaincode = false;
    else if (arg === '--no-start-gw') result.startGw = false;
    else if (arg === '--restart-gw') result.restartGw = true;
    else if (arg === '--prepare-only') result.prepareOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/bootstrap-local-fabric-stack.mjs [options]

Bootstraps the local Fabric devnet, prepares GW local-fabric env, deploys the
local identity and consent-access chaincodes, starts GW CORE in background, and
bootstraps tenant acme-id by default.

Options:
  --tenant-id <id>           Tenant to bootstrap. Default: acme-id
  --env-file <path>          GW env file. Default: .env.local-fabric
  --base-url <url>           GW base URL. Default: http://localhost:3000
  --host-jurisdiction <cc>   Host route jurisdiction. Default: eu
  --data-channel <name>      Fabric data channel. Default: health-care-local
  --identity-channel <name>  Fabric identity channel. Default: identity-local
  --no-bootstrap-tenant      Skip host-side bootstrap of the tenant
  --bootstrap-individual     Also create the canonical individual baseline
  --no-deploy-chaincode      Skip consentaccess-sc deploy
  --no-start-gw              Do not start GW if it is not already reachable
  --prepare-only             Prepare Fabric, chaincodes and env, then exit
  --restart-gw               Stop the current GW process before starting a new one
  --help, -h                 Show this help

Notes:
  - LOCAL_FABRIC_CA_SOURCE=dataspace-ca bridges a disposable offline CA tree
    supplied through DATASPACE_CA_ROOT_DIR and DATASPACE_CA_ISSUER_DIR
  - the GW process is started detached and its PID is written to .local-fabric-gw.pid
  - logs are written under logs/local-fabric-stack-<timestamp>/
  - to stop GW later you can use: npm run local:close`);
}

function requirePath(targetPath, message) {
  if (!existsSync(targetPath)) {
    throw new Error(`${message}: ${targetPath}`);
  }
}

function parseSimpleEnv(text) {
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}

async function runStep(label, options) {
  const logPath = join(runLogDir, `${label}.log`);
  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.write(`[${new Date().toISOString()}] ${label}\n`);

  console.log(`[local-fabric-stack] ${label}`);
  const composeEnv = resolve(options.cwd) === fabricDevnetRoot
    ? {
        COMPOSE_FILE: resolve(fabricDevnetRoot, 'docker-compose.yml'),
        COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME || 'gdc-public-local-network',
      }
    : {};

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...composeEnv,
        ...(options.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });
    child.on('error', (error) => {
      logStream.end();
      rejectPromise(error);
    });
    child.on('close', (code) => {
      logStream.end();
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label} failed with exit code ${code}. See ${logPath}`));
    });
  });
}

async function startGatewayInBackground(envFile) {
  const logPath = join(runLogDir, 'gw-local-fabric.log');
  const logStream = createWriteStream(logPath, { flags: 'a' });

  console.log(`[local-fabric-stack] gw-start-background`);

  await runStep('gw-build-swagger', {
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'build:swagger'],
  });

  const child = spawn(
    'npx',
    [
      'dotenv',
      '-e',
      envFile,
      '--',
      'node',
      '--loader',
      'ts-node/esm',
      '--experimental-specifier-resolution=node',
      'src/main.ts',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: '1',
        TS_NODE_SKIP_IGNORE: '1',
        TS_NODE_COMPILER_OPTIONS: '{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => logStream.write(chunk));
  child.stderr.on('data', (chunk) => logStream.write(chunk));
  child.unref();

  writeFileSync(gwPidFile, `${child.pid}\n`, 'utf8');
  console.log(`[local-fabric-stack] GW PID ${child.pid} -> ${gwPidFile}`);
  console.log(`[local-fabric-stack] GW log -> ${logPath}`);
}

function buildHostPingUrl(baseUrl, hostJurisdiction) {
  const normalized = String(hostJurisdiction || 'eu').toLowerCase();
  return `${String(baseUrl).replace(/\/+$/, '')}/host/cds-${normalized}/v1/local-network/.well-known/ping`;
}

async function waitForPing(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pingUrl(url, 2000)) {
      console.log(`[local-fabric-stack] GW reachable at ${url}`);
      return;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for GW at ${url}`);
}

async function pingUrl(url, timeoutMs) {
  const client = url.startsWith('https://') ? https : http;
  return new Promise((resolvePromise) => {
    const request = client.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolvePromise((response.statusCode || 500) < 500);
    });
    request.on('timeout', () => {
      request.destroy();
      resolvePromise(false);
    });
    request.on('error', () => resolvePromise(false));
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function readPidFile() {
  try {
    return Number(readFileSync(gwPidFile, 'utf8').trim());
  } catch {
    return undefined;
  }
}

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function printSummary(hostPingUrl) {
  console.log('\n[local-fabric-stack] ready');
  console.log(`  logs: ${runLogDir}`);
  console.log(`  gw ping: ${hostPingUrl}`);
  console.log(`  env: ${config.envFile}`);
  console.log(`  tenant: ${config.tenantId}`);
  console.log(`  data channel: ${config.dataChannel}`);
  console.log(`  identity channel: ${config.identityChannel}`);
  console.log('  next: use GW locally or run SDK lifecycle tests against the local stack');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

main().catch((error) => {
  console.error(`\n[local-fabric-stack] ERROR: ${error.message}`);
  process.exit(1);
});
