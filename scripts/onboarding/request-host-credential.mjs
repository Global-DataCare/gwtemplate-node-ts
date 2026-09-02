#!/usr/bin/env node
import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function normalizeDomain(value) {
  const domain = required(value, 'hostDomain').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.')) {
    throw new Error('hostDomain must be one DNS hostname without scheme or path.');
  }
  return domain;
}

function assertServiceUrl(value, hostDomain) {
  const url = new URL(required(value, 'serviceUrl'));
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== hostDomain || url.username || url.password) {
    throw new Error('serviceUrl must be HTTPS and use the exact hostDomain.');
  }
  return url.toString().replace(/\/$/, '');
}

function publicJwk(jwk) {
  const { d: _privatePart, ...publicPart } = jwk;
  return publicPart;
}

async function writePrivateJson(path, value, exclusive = false) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    ...(exclusive ? { flag: 'wx' } : {}),
  });
  await chmod(path, 0o600);
}

/** Generates the private ES384 key used only to sign the activated host request. */
export async function initializeHostRequestKey(input) {
  const hostDomain = normalizeDomain(input.hostDomain);
  const privateJwkFile = required(input.privateJwkFile, 'privateJwkFile');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const privateKeyJwk = privateKey.export({ format: 'jwk' });
  const kid = `did:web:${hostDomain}#host-signing-es384-001`;
  await writePrivateJson(privateJwkFile, { ...privateKeyJwk, kid, alg: 'ES384', use: 'sig' }, true);
  return { kid, publicKeyJwk: publicJwk(privateKeyJwk) };
}

async function loadHostActivation(input, hostDomain, networkKind) {
  const activation = JSON.parse(await readFile(required(input.activationFile, 'activationFile'), 'utf8'));
  const activationCode = required(activation.activationCode, 'activationCode');
  if (normalizeDomain(activation.domain) !== hostDomain) {
    throw new Error('Host activation domain does not match hostDomain.');
  }
  if (required(activation.networkKind, 'activation networkKind').toLowerCase() !== networkKind) {
    throw new Error('Host activation networkKind does not match the request.');
  }
  const expiresAt = Date.parse(required(activation.expiresAt, 'activation expiresAt'));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new Error('Host activation has expired.');
  }
  const approval = activation.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    throw new Error('Host activation must contain the approved host data.');
  }
  const expectedApproval = {
    jurisdiction: required(input.jurisdiction, 'jurisdiction').toUpperCase(),
    sector: required(input.sector, 'sector').toLowerCase(),
    legalName: required(input.legalName, 'legalName'),
    addressCountry: required(input.addressCountry, 'addressCountry').toUpperCase(),
    controllerEmail: required(input.controllerEmail, 'controllerEmail').toLowerCase(),
    serviceUrl: assertServiceUrl(input.serviceUrl, hostDomain),
    ...(input.taxId
      ? { taxId: String(input.taxId).trim() }
      : {
          identifierType: required(input.identifierType, 'identifierType'),
          identifierValue: required(input.identifierValue, 'identifierValue'),
        }),
  };
  if (JSON.stringify(approval) !== JSON.stringify(expectedApproval)) {
    throw new Error('Host manifest does not match the approved host data in the activation.');
  }
  return activationCode;
}

function findCredentialPayload(value) {
  const visited = new Set();
  const credentials = [];
  const jwtEntries = [];
  const walk = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) return;
    visited.add(candidate);
    if (!Array.isArray(candidate)) {
      const types = Array.isArray(candidate.type) ? candidate.type : [];
      if (types.includes('HostingServiceCredential')) credentials.push(candidate);
      if (typeof candidate.credentialId === 'string' && typeof candidate.jwt === 'string') jwtEntries.push(candidate);
    }
    for (const child of Array.isArray(candidate) ? candidate : Object.values(candidate)) walk(child);
  };
  walk(value);
  if (credentials.length !== 1) throw new Error(`ICA response must contain exactly one HostingServiceCredential; found ${credentials.length}.`);
  const credential = credentials[0];
  const jwt = jwtEntries.find((entry) => entry.credentialId === credential.id)?.jwt;
  if (!jwt) throw new Error('ICA response did not contain the VC-JWT for the HostingServiceCredential.');
  return { credential, vcJwt: jwt };
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

async function submitAndPoll(verifyUrl, envelope, activationCode, fetchImpl) {
  const response = await fetchImpl(verifyUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/didcomm-plain+json',
      authorization: `HostActivation ${activationCode}`,
    },
    body: JSON.stringify(envelope),
  });
  if (response.status !== 202) return readJsonResponse(response, 'ICA host verification');
  const location = response.headers.get('location');
  if (!location) throw new Error('ICA returned 202 without a Location header.');
  const pollUrl = new URL(location, verifyUrl).toString();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const poll = await fetchImpl(pollUrl, { headers: { accept: 'application/json' } });
    if (poll.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    return readJsonResponse(poll, 'ICA host verification polling');
  }
  throw new Error('ICA host verification did not complete within 60 seconds.');
}

export async function requestHostCredential(input, fetchImpl = fetch) {
  const hostDomain = normalizeDomain(input.hostDomain);
  const serviceUrl = assertServiceUrl(input.serviceUrl, hostDomain);
  const verifyUrl = required(input.verifyUrl, 'verifyUrl');
  const jurisdiction = required(input.jurisdiction, 'jurisdiction').toUpperCase();
  const sector = required(input.sector, 'sector');
  const networkKind = required(input.networkKind, 'networkKind').toLowerCase();
  if (!['local-network', 'test-network', 'network'].includes(networkKind)) {
    throw new Error('networkKind must be local-network, test-network or network.');
  }
  const activationCode = await loadHostActivation(input, hostDomain, networkKind);
  const privateJwk = JSON.parse(await readFile(required(input.privateJwkFile, 'privateJwkFile'), 'utf8'));
  const kid = required(privateJwk.kid, 'private JWK kid');
  const issuerDid = `did:web:${hostDomain}`;
  if (!kid.startsWith(`${issuerDid}#`) || privateJwk.alg !== 'ES384' || !privateJwk.d) {
    throw new Error('Private JWK must be the ES384 host signing key created by --init.');
  }
  const claims = {
    'org.schema.Organization.legalName': required(input.legalName, 'legalName'),
    'org.schema.Organization.address.addressCountry': required(input.addressCountry, 'addressCountry').toUpperCase(),
    ...(input.taxId ? { 'org.schema.Organization.taxID': String(input.taxId).trim() } : {
      'org.schema.Organization.identifier.additionalType': required(input.identifierType, 'identifierType'),
      'org.schema.Organization.identifier.value': required(input.identifierValue, 'identifierValue'),
    }),
    'org.schema.Service.url': serviceUrl,
    'org.schema.Service.category': sector,
    'org.schema.Service.owner.email': required(input.controllerEmail, 'controllerEmail').toLowerCase(),
  };
  const resource = {
    meta: { claims },
    organization: { did: issuerDid, publicKeyJwk: publicJwk(privateJwk) },
  };
  const authorization = { jurisdiction, sector, networkKind, resourceType: 'contract', resource };
  const protectedSegment = base64urlJson({ alg: 'ES384', kid });
  const payloadSegment = base64urlJson(authorization);
  const signatureSegment = sign('sha384', Buffer.from(`${protectedSegment}.${payloadSegment}`), {
    key: createPrivateKey({ key: privateJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const envelope = {
    jti: randomUUID(),
    thid: randomUUID(),
    iss: issuerDid,
    aud: 'ica',
    type: 'https://www.w3.org/ns/didcomm/application/api+json',
    body: {
      resourceType: 'Bundle',
      type: 'collection',
      total: 1,
      data: [{ type: 'OrganizationVerificationTransactionRequest', resource }],
      hostAuthorizationProof: { jws: `${protectedSegment}.${payloadSegment}.${signatureSegment}` },
    },
  };
  const response = await submitAndPoll(verifyUrl, envelope, activationCode, fetchImpl);
  const result = findCredentialPayload(response);
  await writePrivateJson(required(input.credentialOutputFile, 'credentialOutputFile'), result, true);
  return result;
}

function parseArgs(argv) {
  const options = { init: false, request: false, manifest: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--init') options.init = true;
    else if (value === '--request') options.request = true;
    else if (value === '--manifest') options.manifest = argv[++index] || '';
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (options.init === options.request) throw new Error('Choose exactly one of --init or --request.');
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const manifest = JSON.parse(await readFile(required(options.manifest, '--manifest'), 'utf8'));
  if (options.init) {
    await initializeHostRequestKey(manifest);
    process.stderr.write(`Private host request-signing key created at ${manifest.privateJwkFile}. Keep it under host custody.\n`);
  } else {
    await requestHostCredential(manifest);
    process.stderr.write(`HostingServiceCredential written privately to ${manifest.credentialOutputFile}.\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`host-credential-bootstrap: ${error.message}\n`);
    process.exitCode = 1;
  });
}
