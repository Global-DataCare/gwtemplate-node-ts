import { createGaiaXLegalParticipantCredential } from './credential-generators';// utils/pki-utils.ts

// Author: Fernando Latorre López
// License: Apache License 2.0 (see LICENSE)
// This code is part of a trusted infrastructure project and is provided "as is", without warranty of any kind.
// You are responsible for verifying that it meets your security and compliance requirements.
// Commercial or derivative reuse outside the original infrastructure context requires prior written consent from the author.

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { p256, p384 } from '@noble/curves/nist.js';
import { calculateJwkThumbprint } from 'jose';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

import { Crypto } from '@peculiar/webcrypto';
// globalThis.crypto = new Crypto();
const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

export type AuthorityConfig = {
    seed: string | Uint8Array | undefined; // bytes, hex string or empty for being automatically generated
    legalRegistrationNumber: string;
    domain: string;
    subjectCN: string;
    officialName: string;
    countryCode: string;
    location: { city: string; street?: string; postalCode?: string };
    certFile?: string;  // automatically generated
    jwksFile?: string;  // automatically generated
    didFile?: string;   // automatically generated
    sdFile?: string;    // automatically generated
};

export function generateMSPID(entity: AuthorityConfig): string {
  return `${entity.legalRegistrationNumber}_${entity.domain}`.replace(/\./g, '_').toUpperCase();
}

export function resolveOutputDir(...segments: string[]) {
  const dir = path.join('artifacts', ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveJwkDidAndCredential(
  entity: AuthorityConfig,
  pubJwk: any,
  kid: string,
  outputDir: string
) {
  const didID = `did:web:${entity.domain}`;
  const resolvedAlg = pubJwk.alg || (pubJwk.crv === 'P-384' ? 'ES384' : 'ES256');
  const jwks = { keys: [{ ...pubJwk, kid, alg: resolvedAlg, use: pubJwk.use || 'sig' }] };
  const did = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: didID,
    verificationMethod: [{
      id: `${didID}#${kid}`,
      type: 'JsonWebKey2020',
      controller: didID,
      publicKeyJwk: { ...pubJwk, kid, alg: resolvedAlg, use: pubJwk.use || 'sig' }
    }],
    authentication: [`${didID}#${kid}`]
  };
  
  const termsAndConditionsHash = Buffer.from(sha256(Buffer.from('dummy terms content for test', 'utf8'))).toString('hex');

  const credential = createGaiaXLegalParticipantCredential({
    webDomain: `https://${entity.domain}`,
    officialName: entity.officialName,
    did: didID,
    issuerDid: didID, // Self-issued
    vatId: entity.legalRegistrationNumber,
    countryCode: entity.countryCode,
    termsAndConditionsUrl: `https://${entity.domain}/terms`,
    termsAndConditionsHashHex: termsAndConditionsHash,
  });

  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, `jwks-${entity.domain}.json`), JSON.stringify(jwks, null, 2));
  fs.writeFileSync(path.join(outputDir, `did-${entity.domain}.json`), JSON.stringify(did, null, 2));
  fs.writeFileSync(path.join(outputDir, `LegalParticipantCredential-${entity.domain}.jsonld`), JSON.stringify(credential, null, 2));
}

export function bufferToPem(buf: Buffer, label: string): string {
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

export function bigintToBytes(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export async function deriveKeyPair(seedInput?: string | Uint8Array, curve: 'P-256' | 'P-384' = 'P-256'): Promise<{
  pub: Uint8Array;
  jwk: {
    kty: string;
    crv: string;
    x: string;
    y: string;
    d: string;
  };
  seed: string;
  kid: string;
}> {
  let seedBuf: Buffer;
  if (seedInput instanceof Uint8Array) {
    seedBuf = Buffer.from(seedInput.subarray(0, 32));
  } else if (seedInput?.trim()) {
    seedBuf = Buffer.from(seedInput.replace(/^0x/, ''), 'hex').subarray(0, 32);
  } else {
    seedBuf = Buffer.from(randomBytes(32));
  }

  const seed = Buffer.from(seedBuf).toString('hex');
  const privateKey = curve === 'P-384' ? sha384(seedBuf) : sha256(seedBuf);
  const pub = curve === 'P-384'
    ? p384.getPublicKey(privateKey, false)
    : p256.getPublicKey(privateKey, false); // 0x04 | X | Y

  const coordLen = (pub.length - 1) / 2;
  const x = Buffer.from(pub.slice(1, 1 + coordLen)).toString('base64url');
  const y = Buffer.from(pub.slice(1 + coordLen)).toString('base64url');
  const d = Buffer.from(privateKey).toString('base64url');

  const jwk = { kty: 'EC', crv: curve, x, y, d };
  const { d: _, ...pubJwk } = jwk;
  const thumb = await calculateJwkThumbprint(pubJwk, 'sha256');
  const kid = Buffer.from(thumb).toString('base64url');

  // console.log(`🔐 Generated seed: ${seed}`);
  // console.log(`🆔 Corresponding kid: ${kid}`);

  return { pub, jwk, seed, kid };
}

export async function createCertificate(
  subjectCN: string,
  issuerCN: string,
  subjectKey: CryptoKey,
  issuerKey: CryptoKey,
  publicKeyBytes: Uint8Array,
  years: number,
  legalRegistrationNumber: string,
  curve: 'P-256' | 'P-384' = 'P-256'
): Promise<Buffer> {
  const cert = new pkijs.Certificate();
  cert.serialNumber = new asn1js.Integer({ value: Math.floor(Date.now() / 1000) });

  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: issuerCN })
  }));
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: subjectCN })
  }));
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.97', // organizationIdentifier for ETSI EN 319 412-1, Gaia-X, eIDAS
    value: new asn1js.PrintableString({ value: legalRegistrationNumber })
  }));

  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date();
  cert.notAfter.value.setFullYear(cert.notBefore.value.getFullYear() + years);

  const rawPublicKey = new Uint8Array(publicKeyBytes); // ensure correct format
  const cryptoPub = await crypto.subtle.importKey(
    'raw',
    rawPublicKey,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['verify']
  );
  await cert.subjectPublicKeyInfo.importKey(cryptoPub);

  cert.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.19',
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false)
    })
  ];

  await cert.sign(issuerKey, 'SHA-256');
  return Buffer.from(cert.toSchema(true).toBER(false));
}
