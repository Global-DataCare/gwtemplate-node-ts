/**
 * Flow contract:
 * - one assistant manifest keeps authority, host and platform custody separate;
 * - staging may share infrastructure while production must not claim that mode;
 * - apply requires the exact signed request ID and never treats a password as
 *   downloadable private-key material;
 * - role plans preserve authorization, local enrollment and reconciliation
 *   order without broadening channels.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildRolePlan,
  parseAssistantArgs,
  validateOnboardingManifest,
} from '../lib/workflow.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function manifest(overrides = {}) {
  return {
    specVersion: 'gdc.fabric.host-onboarding-assistant/v1',
    environment: 'staging',
    sharedInfrastructure: true,
    inputs: {
      request: '/secure/request.json',
      decision: '/secure/decision.json',
      controllerDidDocument: '/secure/controller-did.json',
      icaDidDocument: '/secure/ica-did.json',
      inventory: '/secure/inventory.json',
      identityJwks: '/secure/identity-jwks.json',
    },
    authority: {
      caUrl: 'https://fabric-ca.example.invalid:7054',
      caAdminHome: '/secure/ca-admin',
      authorizationOutput: '/secure/authorization.json',
      enrollmentGrantOutput: '/secure/enrollment-grant.json',
    },
    host: {
      peerDns: 'peer0.host.example.invalid',
      mspOutputDir: '/secure/host-msp',
      runtimeOutputDir: '/secure/host-runtime',
    },
    platform: {
      driver: '/opt/fabric/driver.mjs',
      commandMap: '/secure/commands.json',
      state: '/secure/state.json',
      audit: '/secure/audit.jsonl',
    },
    ...overrides,
  };
}

test('accepts logically isolated shared staging infrastructure', () => {
  const value = validateOnboardingManifest(manifest());
  assert.equal(value.environment, 'staging');
  assert.equal(value.sharedInfrastructure, true);
});

test('accepts a disposable local-network manifest with shared infrastructure', () => {
  const example = JSON.parse(readFileSync(
    resolve(repositoryRoot, 'configs/host-onboarding.local.example.json'),
    'utf8',
  ));
  const value = validateOnboardingManifest(example);
  assert.equal(value.environment, 'local');
  assert.equal(value.sharedInfrastructure, true);
  assert.match(buildRolePlan(value, 'authority').join(' '), /mandatory HostingServiceCredential/);
});

test('rejects a production manifest that claims shared infrastructure', () => {
  assert.throws(
    () => validateOnboardingManifest(manifest({ environment: 'production' })),
    /Production onboarding cannot declare sharedInfrastructure=true/,
  );
});

test('ships a valid isolated production manifest with host-local key output', () => {
  const example = JSON.parse(readFileSync(
    resolve(repositoryRoot, 'configs/host-onboarding.production.example.json'),
    'utf8',
  ));
  const value = validateOnboardingManifest(example);
  assert.equal(value.environment, 'production');
  assert.equal(value.sharedInfrastructure, false);
  assert.match(value.host.mspOutputDir, /^\/secure\/host\//);
  assert.match(value.host.runtimeOutputDir, /^\/secure\/host\//);
  assert.doesNotMatch(JSON.stringify(example), /seed|privateKey/i);
});

test('keeps plan mode as default and requires an explicit role', () => {
  assert.deepEqual(
    parseAssistantArgs(['--manifest', 'onboarding.json', '--role', 'host']),
    { manifest: 'onboarding.json', role: 'host', apply: false },
  );
  assert.throws(
    () => parseAssistantArgs(['--manifest', 'onboarding.json']),
    /--role must be authority, host, platform or status/,
  );
});

test('explains that host enrollment creates local keys and receives certificates', () => {
  const plan = buildRolePlan(validateOnboardingManifest(manifest()), 'host').join(' ');
  assert.match(plan, /private keys plus CSRs locally/);
  assert.match(plan, /receive certificates only/);
  assert.match(plan, /sanitized Helm runtime package/);
});

test('places peer runtime reconciliation before governed channel joins', () => {
  const plan = buildRolePlan(validateOnboardingManifest(manifest()), 'platform');
  assert.ok(plan.findIndex((line) => line.includes('peer runtime'))
    < plan.findIndex((line) => line.includes('chaincode packages')));
});
