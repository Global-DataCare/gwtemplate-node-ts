#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const gwRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(gwRoot, '..');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--evidence-dir') result.evidenceDir = argv[++index];
    else if (argument === '--image') result.image = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.evidenceDir) throw new Error('--evidence-dir is required.');
  if (!result.image) throw new Error('--image is required.');
  return result;
}

function git(repositoryRoot, args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' }).trim();
}

function repositoryEvidence(repositoryRoot) {
  return {
    name: basename(repositoryRoot),
    commit: git(repositoryRoot, ['rev-parse', 'HEAD']),
    branch: git(repositoryRoot, ['branch', '--show-current']),
    dirty: git(repositoryRoot, ['status', '--porcelain']).length > 0,
  };
}

function listFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, absolute));
    else if (entry.isFile() && entry.name !== 'manifest.json') files.push(absolute);
  }
  return files;
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readGateStatuses(evidenceDir) {
  const gateDir = join(evidenceDir, 'gates');
  if (!existsSync(gateDir)) return [];
  return readdirSync(gateDir)
    .filter((name) => name.endsWith('.status'))
    .sort()
    .map((name) => ({
      id: name.slice(0, -'.status'.length),
      status: readFileSync(join(gateDir, name), 'utf8').trim(),
    }));
}

function inspectImage(imageName) {
  const raw = execFileSync('docker', ['image', 'inspect', imageName], { encoding: 'utf8' });
  const [image] = JSON.parse(raw);
  return {
    name: imageName,
    id: image.Id,
    repoDigests: image.RepoDigests || [],
    platform: `${image.Os}/${image.Architecture}`,
  };
}

/**
 * Builds the public audit manifest for the local production-readiness proof.
 *
 * The manifest intentionally models Fabric members as Host1MSP/Host2MSP and
 * keeps VAT-addressed tenant Organizations outside Fabric membership. It never
 * reads CA private keys, Fabric enrollment secrets, the local KEK or payloads.
 * Only public artifacts, command logs, hashes and repository/image identities
 * are included.
 */
export function buildEvidenceManifest({
  evidenceDir,
  imageName,
  now = new Date(),
  imageInspector = inspectImage,
}) {
  const resolvedEvidenceDir = resolve(evidenceDir);
  const repositories = [
    gwRoot,
    resolve(workspaceRoot, 'dataspace-ca-ts'),
    resolve(workspaceRoot, 'dataspace-ica-ts'),
    resolve(workspaceRoot, 'fabric-multicloud'),
  ].map(repositoryEvidence);
  const artifacts = listFiles(resolvedEvidenceDir)
    .map((file) => ({
      path: relative(resolvedEvidenceDir, file),
      bytes: statSync(file).size,
      sha256: sha256(file),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    specVersion: 'gdc.open-source.production-readiness-evidence/v1',
    generatedAt: now.toISOString(),
    scope: 'reproducible local-network baseline for production promotion',
    trustBoundaries: {
      offlineDataspaceCa: 'publishes the trust anchor and signs issuer requests',
      dataspaceIca: 'verifies signed legal evidence and issues participant or host VCs',
      fabricIca: 'enrolls Fabric MSP, peer, orderer and client identities',
    },
    localNetwork: {
      networkMode: 'local-network',
      sector: 'onehealth-research',
      identityChannel: 'identity-local',
      dataChannel: 'health-care-local',
      fabricMembers: ['Host1MSP', 'Host2MSP'],
      tenantBoundary: 'VAT-addressed tenant Organizations are hosted application data, not Fabric MSPs',
    },
    productionChannelProjection: {
      euOrganizationsAndEmployees: 'identity-eu',
      humanIndividuals: 'identity-global',
      euHealthData: 'health-care-eu',
      excludedScope: 'animal identity, veterinary services and animal channels',
    },
    humanAccessProof: {
      hostedRoutes: ['entity', 'individual'],
      employeeRole: 'ISCO-08|4226',
      positiveControl: 'explicit consent permits SMART IPS read by the selected medical secretary',
      negativeControl: 'a different medical secretary without consent receives no access token',
    },
    repositories,
    image: imageInspector(imageName),
    gates: readGateStatuses(resolvedEvidenceDir),
    artifacts,
    productionPromotionConditions: [
      'replace the local KEK with one process-owned KEK unwrapped once through the configured KMS adapter',
      'use production DNS, TLS, secret custody, persistent volumes and monitored backup/recovery',
      'use production Fabric Root/ICA material and governed channel inventory',
      'exercise the real operator-owned Fabric reconciliation driver before claiming dynamic host admission',
      'deploy the already-tested image by immutable registry digest',
    ],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = buildEvidenceManifest({
    evidenceDir: options.evidenceDir,
    imageName: options.image,
  });
  const output = join(resolve(options.evidenceDir), 'manifest.json');
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${output}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`open-source-evidence-manifest: ${error.message}\n`);
    process.exitCode = 1;
  }
}
