/**
 * Flow contract:
 * - the Root controller signs one canonical declarative decision;
 * - inventory, not request data, owns allowed networks, channels, MSPs and peers;
 * - planning is deterministic and exact;
 * - apply is idempotent, re-inspected and audited by the runtime reconciler.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { canonicalJson } from '../lib/canonical-json.mjs';
import { validateDecision } from '../lib/decision.mjs';
import { verifyControllerJws, verifyOperatorIdentityToken } from '../lib/jws.mjs';
import { buildPlan } from '../lib/planner.mjs';
import { authorizeHostEnrollment } from '../../enrollment/authorize-host-enrollment.mjs';

const controllerDid = 'did:web:ca.example.invalid';
const controllerKid = `${controllerDid}#root-controller`;
const execFileAsync = promisify(execFile);
const inventory = {
  specVersion: 'gdc.fabric.reconciler-inventory/v1',
  governance: {
    tenantId: 'governance-test',
    controllerEmails: ['controller@example.invalid'],
    controllerDids: [controllerDid],
    identityIssuers: ['https://identity.example.invalid'],
    identityAudiences: ['governance-test-audience'],
    trustedIcaDids: ['did:web:ica.example.invalid'],
  },
  networks: {
    'gdc-human-health': {
      networkKind: 'network',
      ordererTarget: 'root-orderer',
      channels: ['identity-global', 'identity-eu'],
      governanceExecutorMspId: 'ROOTMSP',
      msps: {
        ROOTMSP: { peerTargets: ['root-peer'] },
        HOSTMSP: { peerTargets: ['host-peer'] },
        OTHERMSP: { peerTargets: ['other-peer'] },
      },
    },
  },
  targets: {
    'root-orderer': { kind: 'orderer' },
    'root-peer': { kind: 'peer', mspId: 'ROOTMSP' },
    'host-peer': { kind: 'peer', mspId: 'HOSTMSP' },
    'other-peer': { kind: 'peer', mspId: 'OTHERMSP' },
  },
};

function decision(overrides = {}) {
  return {
    specVersion: 'gdc.fabric.channel-governance/v1',
    requestId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    issuedAt: '2026-07-29T09:05:00.000Z',
    expiresAt: '2026-07-29T10:05:00.000Z',
    network: 'gdc-human-health',
    governance: {
      tenantId: 'governance-test',
      controllerDid,
      controllerKid,
      controllerEmail: 'controller@example.invalid',
      hostAuthorizationSha256: 'a'.repeat(64),
    },
    operator: {
      issuer: 'https://identity.example.invalid',
      subject: 'operator-test-subject',
      email: 'controller@example.invalid',
      tenantId: 'governance-test',
      authenticatedAt: '2026-07-29T09:00:00.000Z',
    },
    changes: [{
      operation: 'admit-organization',
      channel: 'identity-eu',
      mspId: 'HOSTMSP',
      mspDefinitionSha256: 'b'.repeat(64),
      peerTargets: ['host-peer'],
      grants: ['read'],
      chaincodes: [{
        name: 'organization',
        version: '1.0.0',
        sequence: 1,
        packageId: 'organization_1.0.0:package-digest',
        endorsementPolicySha256: 'c'.repeat(64),
      }],
    }],
    ...overrides,
  };
}

function hostCredentialJwt(now) {
  const issuer = 'did:web:ica.example.invalid';
  const kid = `${issuer}#host-vc-signer`;
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const header = Buffer.from(JSON.stringify({ alg: 'ES384', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    sub: 'https://host.example.invalid',
    jti: 'urn:uuid:10000000-0000-4000-8000-000000000001',
    nbf: Math.floor(now / 1000) - 60,
    exp: Math.floor(now / 1000) + 3600,
    vc: {
      id: 'urn:uuid:10000000-0000-4000-8000-000000000001',
      type: ['VerifiableCredential', 'ServiceCredential', 'HostingServiceCredential'],
      credentialSubject: { id: 'https://host.example.invalid' },
    },
  })).toString('base64url');
  const signature = sign('sha384', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    jwt: `${header}.${payload}.${signature}`,
    didDocument: {
      id: issuer,
      verificationMethod: [{
        id: kid,
        controller: issuer,
        type: 'JsonWebKey2020',
        publicKeyJwk: { ...publicKey.export({ format: 'jwk' }), kid: 'host-vc-signer', alg: 'ES384' },
      }],
      assertionMethod: [kid],
    },
  };
}

function signDecision(value) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyJwk = publicKey.export({ format: 'jwk' });
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: controllerKid })).toString('base64url');
  const payload = canonicalJson(value);
  const signingInput = Buffer.from(`${header}.${Buffer.from(payload).toString('base64url')}`);
  const signature = sign('sha256', signingInput, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    envelope: { decision: value, approval: { jws: `${header}..${signature}` } },
    didDocument: {
      id: controllerDid,
      verificationMethod: [{
        id: controllerKid,
        controller: controllerDid,
        type: 'JsonWebKey2020',
        publicKeyJwk: { ...publicKeyJwk, alg: 'ES256' },
      }],
      assertionMethod: [controllerKid],
    },
  };
}

function identityToken(operator, now = Date.now()) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'identity-provider-test-key';
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: operator.issuer,
    aud: 'governance-test-audience',
    sub: operator.subject,
    email: operator.email,
    email_verified: true,
    tenant_id: operator.tenantId,
    iat: Math.floor(Date.parse(operator.authenticatedAt) / 1000),
    exp: Math.floor(now / 1000) + 300,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return {
    jwt: `${header}.${payload}.${signature}`,
    jwks: {
      keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }],
    },
  };
}

test('validates inventory-bound decisions and builds an exact deterministic plan', () => {
  const value = decision();
  validateDecision(value, inventory, Date.parse('2026-07-29T09:06:00.000Z'));
  const plan = buildPlan(value, inventory);
  assert.deepEqual(plan.steps.map((entry) => [entry.type, entry.target]), [
    ['ensure-application-msp', 'root-orderer'],
    ['ensure-channel-grants', 'root-orderer'],
    ['ensure-peer-runtime', 'host-peer'],
    ['ensure-peer-channel', 'host-peer'],
    ['ensure-chaincode-approved', 'host-peer'],
    ['ensure-chaincode-committed', 'root-orderer'],
  ]);
  assert.equal(buildPlan(value, inventory).digest, plan.digest);
});

test('rejects request-selected channels, peers, mismatched operator identity and expiry', () => {
  const now = Date.parse('2026-07-29T09:06:00.000Z');
  assert.throws(
    () => validateDecision(decision({ changes: [{ ...decision().changes[0], channel: 'identity-na' }] }), inventory, now),
    /not in governed inventory/,
  );
  assert.throws(
    () => validateDecision(decision({ changes: [{ ...decision().changes[0], peerTargets: ['root-peer'] }] }), inventory, now),
    /unauthorized target/,
  );
  assert.throws(
    () => validateDecision(decision({ operator: { ...decision().operator, email: 'other@example.invalid' } }), inventory, now),
    /does not match the signing controller/,
  );
  assert.throws(
    () => validateDecision(decision(), inventory, Date.parse('2026-07-29T10:06:00.000Z')),
    /expired/,
  );
});

test('orders every organization approval before one governance-executor commit', () => {
  const first = decision().changes[0];
  const second = {
    ...first,
    mspId: 'OTHERMSP',
    mspDefinitionSha256: 'd'.repeat(64),
    peerTargets: ['other-peer'],
  };
  const plan = buildPlan(decision({ changes: [first, second] }), inventory);
  const types = plan.steps.map((entry) => entry.type);
  assert.equal(types.filter((entry) => entry === 'ensure-chaincode-approved').length, 2);
  assert.equal(types.filter((entry) => entry === 'ensure-chaincode-committed').length, 1);
  assert.ok(
    types.lastIndexOf('ensure-chaincode-approved') < types.indexOf('ensure-chaincode-committed'),
    'all local approvals must precede the governed commit',
  );
});

test('verifies a detached ES256 controller signature against DID assertionMethod', async () => {
  const value = decision();
  const payload = canonicalJson(value);
  const { envelope, didDocument } = signDecision(value);
  await assert.doesNotReject(() => verifyControllerJws({
    jws: envelope.approval.jws,
    payload,
    didDocument,
    controllerDid,
    controllerKid,
  }));
  await assert.rejects(() => verifyControllerJws({
    jws: envelope.approval.jws,
    payload: `${payload} `,
    didDocument,
    controllerDid,
    controllerKid,
  }), /Invalid controller governance signature/);
});

test('verifies a detached ML-DSA-44 controller signature against DID assertionMethod', async () => {
  const { ml_dsa44: mlDsa44 } = await import('@noble/post-quantum/ml-dsa.js');
  const value = decision();
  const payload = canonicalJson(value);
  const header = Buffer.from(JSON.stringify({ alg: 'ML-DSA-44', kid: controllerKid })).toString('base64url');
  const signingInput = Buffer.from(`${header}.${Buffer.from(payload).toString('base64url')}`);
  const { publicKey, secretKey } = mlDsa44.keygen(new Uint8Array(32).fill(7));
  const signature = Buffer.from(mlDsa44.sign(signingInput, secretKey)).toString('base64url');
  const didDocument = {
    id: controllerDid,
    verificationMethod: [{
      id: controllerKid,
      controller: controllerDid,
      type: 'JsonWebKey2020',
      publicKeyJwk: {
        kty: 'AKP',
        alg: 'ML-DSA-44',
        pub: Buffer.from(publicKey).toString('base64url'),
      },
    }],
    assertionMethod: [controllerKid],
  };
  await assert.doesNotReject(() => verifyControllerJws({
    jws: `${header}..${signature}`,
    payload,
    didDocument,
    controllerDid,
    controllerKid,
  }));
});

test('verifies current operator token and exact issuer, subject, email and tenant', () => {
  const operator = decision().operator;
  const authentication = identityToken(operator);
  const verified = verifyOperatorIdentityToken({
    jwt: authentication.jwt,
    jwks: authentication.jwks,
    expected: operator,
    allowedAudiences: inventory.governance.identityAudiences,
  });
  assert.equal(verified.issuer, operator.issuer);
  assert.equal(verified.subject, operator.subject);
  assert.equal(verified.email, operator.email);
  assert.equal(verified.tenantId, operator.tenantId);
  assert.equal(typeof verified.issuedAt, 'number');
  assert.equal(typeof verified.expiresAt, 'number');
  assert.throws(
    () => verifyOperatorIdentityToken({
      jwt: authentication.jwt,
      jwks: authentication.jwks,
      expected: { ...operator, tenantId: 'other-tenant' },
      allowedAudiences: inventory.governance.identityAudiences,
    }),
    /tenant does not match/,
  );
});

test('authorizes host enrollment only when Host VC and Root governance decision match the same host MSP', async () => {
  const now = Date.parse('2026-07-29T09:06:00.000Z');
  const value = decision();
  const { envelope, didDocument } = signDecision(value);
  const authentication = identityToken(value.operator, now);
  envelope.authentication = { jwt: authentication.jwt };
  const hostCredential = hostCredentialJwt(now);
  const request = {
    specVersion: 'gdc.fabric.host-enrollment/v1',
    hostUrl: 'https://host.example.invalid',
    mspId: 'HOSTMSP',
    hostCredentialJwt: hostCredential.jwt,
    governanceDecision: envelope,
  };
  const authorized = await authorizeHostEnrollment({
    request,
    controllerDidDocument: didDocument,
    icaDidDocument: hostCredential.didDocument,
    inventory,
    identityJwks: authentication.jwks,
    now,
  });
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.mspId, 'HOSTMSP');
  assert.equal(authorized.hostUrl, 'https://host.example.invalid');
  assert.deepEqual(authorized.peerTargets, ['host-peer']);
  assert.equal(authorized.evidencePolicy, 'hosting-service-credential');

  await assert.rejects(() => authorizeHostEnrollment({
    request: { ...request, hostUrl: 'https://other-host.example.invalid' },
    controllerDidDocument: didDocument,
    icaDidDocument: hostCredential.didDocument,
    inventory,
    identityJwks: authentication.jwks,
    now,
  }), /subject must equal request.hostUrl/);
});

test('allows controller-approved technical enrollment without a Host VC only outside production', async () => {
  const now = Date.parse('2026-07-29T09:06:00.000Z');
  for (const networkKind of ['local-network', 'test-network']) {
    const value = decision();
    const { envelope, didDocument } = signDecision(value);
    const authentication = identityToken(value.operator, now);
    envelope.authentication = { jwt: authentication.jwt };
    const technicalInventory = {
      ...inventory,
      networks: {
        ...inventory.networks,
        'gdc-human-health': { ...inventory.networks['gdc-human-health'], networkKind },
      },
      governance: { ...inventory.governance, trustedIcaDids: [] },
    };
    const hostUrl = networkKind === 'local-network'
      ? 'http://host2.localhost'
      : 'https://host-st.example.invalid';
    const authorized = await authorizeHostEnrollment({
      request: {
        specVersion: 'gdc.fabric.host-enrollment/v1',
        hostUrl,
        mspId: 'HOSTMSP',
        governanceDecision: envelope,
      },
      controllerDidDocument: didDocument,
      inventory: technicalInventory,
      identityJwks: authentication.jwks,
      now,
    });
    assert.equal(authorized.authorized, true);
    assert.equal(authorized.hostUrl, hostUrl);
    assert.equal(authorized.networkKind, networkKind);
    assert.equal(authorized.evidencePolicy, 'controller-approval');
    assert.equal(authorized.hostCredentialId, undefined);
  }
});

test('fails closed when a production host omits HostingServiceCredential', async () => {
  const now = Date.parse('2026-07-29T09:06:00.000Z');
  const value = decision();
  const { envelope, didDocument } = signDecision(value);
  const authentication = identityToken(value.operator, now);
  envelope.authentication = { jwt: authentication.jwt };
  await assert.rejects(() => authorizeHostEnrollment({
    request: {
      specVersion: 'gdc.fabric.host-enrollment/v1',
      hostUrl: 'https://host.example.invalid',
      mspId: 'HOSTMSP',
      governanceDecision: envelope,
    },
    controllerDidDocument: didDocument,
    inventory,
    identityJwks: authentication.jwks,
    now,
  }), /Production network requires a HostingServiceCredential/);
});

test('apply re-inspects every step, persists completion and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fabric-reconciler-test-'));
  const now = Date.now();
  const value = decision({
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    operator: {
      ...decision().operator,
      authenticatedAt: new Date(now - 120_000).toISOString(),
    },
  });
  const { envelope, didDocument } = signDecision(value);
  const authentication = identityToken(value.operator, now);
  envelope.authentication = { jwt: authentication.jwt };
  const paths = {
    decision: join(directory, 'decision.json'),
    did: join(directory, 'did.json'),
    inventory: join(directory, 'inventory.json'),
    identityJwks: join(directory, 'identity-jwks.json'),
    state: join(directory, 'state.json'),
    audit: join(directory, 'audit.jsonl'),
    driverState: join(directory, 'driver-state.json'),
    driver: join(directory, 'driver.mjs'),
  };
  await Promise.all([
    writeFile(paths.decision, JSON.stringify(envelope)),
    writeFile(paths.did, JSON.stringify(didDocument)),
    writeFile(paths.inventory, JSON.stringify(inventory)),
    writeFile(paths.identityJwks, JSON.stringify(authentication.jwks)),
    writeFile(paths.driver, `#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const step = JSON.parse(Buffer.concat(chunks).toString('utf8'));
let completed = [];
try { completed = JSON.parse(await readFile(process.env.FAKE_DRIVER_STATE, 'utf8')); } catch {}
if (process.argv[2] === 'apply' && !completed.includes(step.id)) {
  completed.push(step.id);
  await writeFile(process.env.FAKE_DRIVER_STATE, JSON.stringify(completed));
}
process.stdout.write(JSON.stringify({ satisfied: completed.includes(step.id) }));
`),
  ]);
  await chmod(paths.driver, 0o700);
  const args = [
    'scripts/governance/reconcile.mjs',
    '--decision', paths.decision,
    '--did-document', paths.did,
    '--inventory', paths.inventory,
    '--identity-jwks', paths.identityJwks,
    '--driver', paths.driver,
    '--state', paths.state,
    '--audit', paths.audit,
    '--apply',
  ];
  const env = { ...process.env, FAKE_DRIVER_STATE: paths.driverState };
  const first = await execFileAsync(process.execPath, args, { cwd: resolve('.'), env });
  assert.equal(JSON.parse(first.stdout).verified, true);
  const auditAfterFirst = (await readFile(paths.audit, 'utf8')).trim().split('\n');
  assert.equal(auditAfterFirst.filter((line) => JSON.parse(line).status === 'completed').length, 6);
  await execFileAsync(process.execPath, args, { cwd: resolve('.'), env });
  const auditAfterSecond = (await readFile(paths.audit, 'utf8')).trim().split('\n');
  assert.equal(auditAfterSecond.length, auditAfterFirst.length);
  const state = JSON.parse(await readFile(paths.state, 'utf8'));
  assert.equal(Object.keys(state.requests[value.requestId].completedSteps).length, 6);
});
