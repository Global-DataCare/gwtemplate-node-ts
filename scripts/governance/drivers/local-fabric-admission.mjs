#!/usr/bin/env node
/**
 * Live local-network driver for the admission subset of the reconciler.
 * It inspects actual channel config and peer state; only a missing application
 * MSP invokes the governed Host2 admission script. It is not a mock and is not
 * used as a production credential adapter.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const prefix = process.env.GDC_CONTAINER_PREFIX || 'gdc';
const tools = `${prefix}-fabric-tools`;
const host1Admin = '/workspace/organizations/peerOrganizations/host1.example.com/users/Admin@host1.example.com/msp';
const host1Tls = '/workspace/organizations/peerOrganizations/host1.example.com/peers/peer0.host1.example.com/tls/ca.crt';
const host2Admin = '/workspace/organizations/peerOrganizations/host2.example.com/users/Admin@host2.example.com/msp';
const host2Tls = '/workspace/organizations/peerOrganizations/host2.example.com/peers/peer0.host2.example.com/tls/ca.crt';
const ordererTls = '/workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt';

async function readStep() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function peerArgs(mspId, admin, address, tls) {
  return [
    'docker', 'exec',
    '-e', `CORE_PEER_LOCALMSPID=${mspId}`,
    '-e', `CORE_PEER_MSPCONFIGPATH=${admin}`,
    '-e', `CORE_PEER_ADDRESS=${address}`,
    '-e', 'CORE_PEER_TLS_ENABLED=true',
    '-e', `CORE_PEER_TLS_ROOTCERT_FILE=${tls}`,
    tools,
  ];
}

function inspectMembership(channel) {
  const safeChannel = String(channel).replace(/[^a-z0-9-]/g, '');
  const block = `/tmp/${safeChannel}-host2-config.pb`;
  const json = `/tmp/${safeChannel}-host2-config.json`;
  try {
    run([
      ...peerArgs('Host1MSP', host1Admin, 'peer0-host1:7051', host1Tls),
      'peer', 'channel', 'fetch', 'config', block,
      '-o', 'orderer:7050', '--ordererTLSHostnameOverride', 'orderer',
      '-c', channel, '--tls', '--cafile', ordererTls,
    ]);
    run(['docker', 'exec', tools, 'configtxlator', 'proto_decode',
      '--input', block, '--type', 'common.Block', '--output', json]);
    run(['docker', 'exec', tools, 'jq', '-e',
      '.data.data[0].payload.data.config.channel_group.groups.Application.groups.Host2MSP', json]);
    return true;
  } catch {
    return false;
  }
}

function inspectPeerRuntime() {
  try {
    return run(['docker', 'inspect', '-f', '{{.State.Running}}', `${prefix}-peer0-host2`]).trim() === 'true';
  } catch {
    return false;
  }
}

function inspectPeerChannel(channel) {
  if (!inspectPeerRuntime()) return false;
  try {
    const output = run([
      ...peerArgs('Host2MSP', host2Admin, 'peer0-host2:7051', host2Tls),
      'peer', 'channel', 'list',
    ]);
    return output.split(/\r?\n/).includes(channel);
  } catch {
    return false;
  }
}

function inspect(step) {
  if (step.type === 'ensure-application-msp' || step.type === 'ensure-channel-grants') {
    return inspectMembership(step.input.channel);
  }
  if (step.type === 'ensure-peer-runtime') return inspectPeerRuntime();
  if (step.type === 'ensure-peer-channel') return inspectPeerChannel(step.input.channel);
  throw new Error(`Unsupported local admission step: ${step.type}`);
}

function apply(step) {
  if (step.type !== 'ensure-application-msp') {
    throw new Error(`Step ${step.type} was not satisfied after governed MSP admission.`);
  }
  const authorization = process.env.HOST_AUTHORIZATION_JSON;
  if (!authorization) throw new Error('HOST_AUTHORIZATION_JSON is required for local admission apply.');
  run(['bash', './scripts/06-admit-host2.sh'], {
    cwd: resolve(repoRoot, 'infra/fabric/local-network'),
    env: {
      HOST_AUTHORIZATION_JSON: authorization,
      HLF_BOOTSTRAP_CHANNELS: 'identity-local,health-care-local',
      SINGLE_HOST: 'true',
    },
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'inspect' && mode !== 'apply') throw new Error('Mode must be inspect or apply.');
  const step = await readStep();
  if (mode === 'apply') apply(step);
  process.stdout.write(`${JSON.stringify({ satisfied: inspect(step) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`local-fabric-admission-driver: ${error.message}\n`);
  process.exitCode = 1;
});
