#!/usr/bin/env node
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { authorizeHostEnrollment } from '../enrollment/authorize-host-enrollment.mjs';
import { canonicalJson } from '../governance/lib/canonical-json.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') result.output = resolve(argv[++index]);
    else if (argv[index] === '--bundle-dir') result.bundleDir = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!result.output) {
    throw new Error('Usage: create-local-audit-authorization.mjs --output <authorization.json> [--bundle-dir <dir>]');
  }
  return result;
}

function compactJws(payload, privateKey, header, algorithm) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(algorithm, Buffer.from(`${encodedHeader}.${encodedPayload}`), {
    key: privateKey,
    dsaEncoding: header.alg.startsWith('ES') ? 'ieee-p1363' : undefined,
  }).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function buildAuthorization(now = Date.now()) {
  const controllerDid = 'did:web:ca.localhost';
  const controllerKid = `${controllerDid}#root-controller`;
  const icaDid = 'did:web:ica.localhost';
  const icaKid = `${icaDid}#host-vc-signer`;
  const identityIssuer = 'https://identity.localhost';
  const operator = {
    issuer: identityIssuer,
    subject: 'local-auditor',
    email: 'controller@example.invalid',
    tenantId: 'local-governor',
    authenticatedAt: new Date(now - 30_000).toISOString(),
  };
  const decision = {
    specVersion: 'gdc.fabric.channel-governance/v1',
    requestId: `urn:uuid:${randomUUID()}`,
    issuedAt: new Date(now - 30_000).toISOString(),
    expiresAt: new Date(now + 15 * 60_000).toISOString(),
    network: 'local-audit',
    governance: {
      tenantId: 'local-governor',
      controllerDid,
      controllerKid,
      controllerEmail: operator.email,
      hostAuthorizationSha256: 'a'.repeat(64),
    },
    operator,
    changes: ['identity-local', 'health-care-local'].map((channel) => ({
      operation: 'admit-organization', channel, mspId: 'Host2MSP',
      mspDefinitionSha256: 'b'.repeat(64), peerTargets: ['host2-peer'],
      grants: ['read', 'write'], chaincodes: [],
    })),
  };
  const inventory = {
    specVersion: 'gdc.fabric.reconciler-inventory/v1',
    governance: {
      tenantId: 'local-governor',
      controllerEmails: [operator.email],
      controllerDids: [controllerDid],
      identityIssuers: [identityIssuer],
      identityAudiences: ['local-audit'],
      trustedIcaDids: [icaDid],
    },
    networks: {
      'local-audit': {
        networkKind: 'local-network',
        ordererTarget: 'local-orderer',
        channels: ['identity-local', 'health-care-local'],
        governanceExecutorMspId: 'Host1MSP',
        msps: { Host2MSP: { peerTargets: ['host2-peer'] } },
      },
    },
    targets: {
      'local-orderer': { kind: 'orderer' },
      'host2-peer': { kind: 'peer', mspId: 'Host2MSP' },
    },
  };

  const controllerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const decisionHeader = Buffer.from(JSON.stringify({ alg: 'ES256', kid: controllerKid })).toString('base64url');
  const decisionPayload = canonicalJson(decision);
  const decisionSignature = sign(
    'sha256',
    Buffer.from(`${decisionHeader}.${Buffer.from(decisionPayload).toString('base64url')}`),
    { key: controllerKeys.privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  const controllerDidDocument = {
    id: controllerDid,
    verificationMethod: [{
      id: controllerKid,
      controller: controllerDid,
      type: 'JsonWebKey2020',
      publicKeyJwk: { ...controllerKeys.publicKey.export({ format: 'jwk' }), alg: 'ES256' },
    }],
    assertionMethod: [controllerKid],
  };

  const icaKeys = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const credentialId = `urn:uuid:${randomUUID()}`;
  const hostUrl = 'http://host2.localhost';
  const hostCredentialJwt = compactJws({
    iss: icaDid,
    sub: hostUrl,
    jti: credentialId,
    nbf: Math.floor(now / 1000) - 60,
    exp: Math.floor(now / 1000) + 900,
    vc: {
      id: credentialId,
      type: ['VerifiableCredential', 'ServiceCredential', 'HostingServiceCredential'],
      credentialSubject: { id: hostUrl },
    },
  }, icaKeys.privateKey, { alg: 'ES384', kid: icaKid }, 'sha384');
  const icaDidDocument = {
    id: icaDid,
    verificationMethod: [{
      id: icaKid,
      controller: icaDid,
      type: 'JsonWebKey2020',
      publicKeyJwk: { ...icaKeys.publicKey.export({ format: 'jwk' }), alg: 'ES384' },
    }],
    assertionMethod: [icaKid],
  };

  const identityKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const identityKid = 'local-identity-key';
  const identityJwt = compactJws({
    iss: identityIssuer,
    aud: 'local-audit',
    sub: operator.subject,
    email: operator.email,
    email_verified: true,
    tenant_id: operator.tenantId,
    iat: Math.floor(Date.parse(operator.authenticatedAt) / 1000),
    exp: Math.floor(now / 1000) + 300,
  }, identityKeys.privateKey, { alg: 'RS256', kid: identityKid }, 'RSA-SHA256');
  const identityJwks = {
    keys: [{ ...identityKeys.publicKey.export({ format: 'jwk' }), kid: identityKid, alg: 'RS256', use: 'sig' }],
  };

  const governanceDecision = {
    decision,
    approval: { jws: `${decisionHeader}..${decisionSignature}` },
    authentication: { jwt: identityJwt },
  };
  const authorization = await authorizeHostEnrollment({
    request: {
      specVersion: 'gdc.fabric.host-enrollment/v1',
      hostUrl,
      mspId: 'Host2MSP',
      hostCredentialJwt,
      governanceDecision,
    },
    controllerDidDocument,
    icaDidDocument,
    inventory,
    identityJwks,
    now,
  });
  return { authorization, governanceDecision, controllerDidDocument, inventory, identityJwks };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const bundle = await buildAuthorization();
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(bundle.authorization, null, 2)}\n`, { mode: 0o600 });
  if (options.bundleDir) {
    await mkdir(options.bundleDir, { recursive: true, mode: 0o700 });
    const artifacts = {
      'decision.json': bundle.governanceDecision,
      'controller-did.json': bundle.controllerDidDocument,
      'inventory.json': bundle.inventory,
      'identity-jwks.json': bundle.identityJwks,
    };
    await Promise.all(Object.entries(artifacts).map(([name, value]) =>
      writeFile(resolve(options.bundleDir, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })));
  }
  process.stderr.write(`Sanitized local Host2 authorization written to ${options.output}.\n`);
}

main().catch((error) => {
  process.stderr.write(`local-audit-host-authorization: ${error.message}\n`);
  process.exitCode = 1;
});
