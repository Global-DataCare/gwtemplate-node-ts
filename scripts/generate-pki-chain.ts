// scripts/generate-pki-chain.ts
import 'dotenv/config';

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { Crypto } from '@peculiar/webcrypto';
import * as pkijs from 'pkijs';
import {
  AuthorityConfig,
  bufferToPem,
  createCertificate,
  deriveKeyPair,
  generateMSPID,
  resolveOutputDir,
  saveJwkDidAndCredential,
} from '../src/utils/pki';

const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const ROOT_CA_DOMAIN = getEnv('DOMAIN_ROOT_CA');
const ICA_DOMAIN = getEnv('DOMAIN_ICA');
const ORG_JURISDICTION = getEnv('ORG_JURISDICTION');
const ORG_CITY = getEnv('ORG_CITY');
const ORG_STREET = getEnv('ORG_STREET');
const ORG_POSTAL_CODE = getEnv('ORG_POSTAL_CODE');

const ROOT_CA_SEED = process.env.ROOT_CA_SEED || 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
const ICA_SEED = process.env.ICA_SEED || '';
const TENANT_SEED = process.env.TENANT_SEED || '';
const LEGACY_SIGN_ALG = (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
  ? process.env.LEGACY_SIGN_ALG
  : 'ES384';
const LEGACY_CURVE: 'P-256' | 'P-384' = LEGACY_SIGN_ALG === 'ES384' ? 'P-384' : 'P-256';

const rootCA: AuthorityConfig = {
  legalRegistrationNumber: getEnv('ROOT_CA_LEGAL_NUMBER'),
  domain: ROOT_CA_DOMAIN,
  subjectCN: ROOT_CA_DOMAIN,
  officialName: getEnv('ROOT_CA_ORG_NAME'),
  countryCode: ORG_JURISDICTION,
  location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
  seed: ROOT_CA_SEED,
};

const ica: AuthorityConfig = {
  legalRegistrationNumber: getEnv('ICA_LEGAL_NUMBER'),
  domain: ICA_DOMAIN,
  subjectCN: ICA_DOMAIN,
  officialName: getEnv('ICA_ORG_NAME'),
  countryCode: ORG_JURISDICTION,
  location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
  seed: ICA_SEED,
};

const hostCert: AuthorityConfig = {
  legalRegistrationNumber: getEnv('HOST_LEGAL_NUMBER'),
  domain: getEnv('HOST_DOMAIN'),
  subjectCN: getEnv('HOST_CN'),
  officialName: getEnv('HOST_ORG_NAME'),
  countryCode: ORG_JURISDICTION,
  location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
  seed: process.env.HOST_SEED || '',
};

function cleanOutputDirs() {
  rmSync('fabric-ca-server-root', { recursive: true, force: true });
  rmSync('fabric-ca-server-ica', { recursive: true, force: true });
}

async function generateCertificates() {
  cleanOutputDirs();
  mkdirSync('fabric-ca-server-root', { recursive: true });
  mkdirSync('fabric-ca-server-ica', { recursive: true });

  // Root CA
  const rootKeyPair = await deriveKeyPair(rootCA.seed as string, LEGACY_CURVE);
  const rootKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const rootCert = await createCertificate(rootCA.subjectCN, rootCA.subjectCN, rootKey, rootKey, rootKeyPair.pub, 10, rootCA.legalRegistrationNumber, LEGACY_CURVE);

  writeFileSync('fabric-ca-server-root/ca-cert.pem', bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync('fabric-ca-server-root/ca-key.pem', bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', rootKey)), 'PRIVATE KEY'));

  const rootOut = resolveOutputDir('full-pki-chain-root-ca');
  writeFileSync(`${rootOut}/root-cert.pem`, bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync(`${rootOut}/root-cert.der`, rootCert);
  const { d: _rootPriv, ...rootPubJwk } = rootKeyPair.jwk;
  await saveJwkDidAndCredential(rootCA, rootPubJwk, rootKeyPair.kid, rootOut);
  writeFileSync(`${rootOut}/private-jwk.json`, JSON.stringify(rootKeyPair.jwk, null, 2));

  // ICA
  const icaKeyPair = await deriveKeyPair(ica.seed as string, LEGACY_CURVE);
  const icaKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const icaCert = await createCertificate(ica.subjectCN, rootCA.subjectCN, icaKey, rootKey, icaKeyPair.pub, 5, ica.legalRegistrationNumber, LEGACY_CURVE);

  writeFileSync('fabric-ca-server-ica/ca-cert.pem', bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync('fabric-ca-server-ica/ca-key.pem', bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', icaKey)), 'PRIVATE KEY'));
  writeFileSync('fabric-ca-server-ica/ca-chain.pem', bufferToPem(rootCert, 'CERTIFICATE'));

  const icaOut = resolveOutputDir('full-pki-chain-ica');
  writeFileSync(`${icaOut}/ica-cert.pem`, bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(`${icaOut}/ica-cert.der`, icaCert);
  const { d: _icaPriv, ...icaPubJwk } = icaKeyPair.jwk;
  await saveJwkDidAndCredential(ica, icaPubJwk, icaKeyPair.kid, icaOut);
  writeFileSync(`${icaOut}/private-jwk.json`, JSON.stringify(icaKeyPair.jwk, null, 2));

  // Tenant / MSP
  const hostKeyPair = await deriveKeyPair(hostCert.seed as string, LEGACY_CURVE);
  const hostKey = await crypto.subtle.importKey('jwk', hostKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const hostCertBuffer = await createCertificate(hostCert.subjectCN, ica.subjectCN, hostKey, icaKey, hostKeyPair.pub, 2, hostCert.legalRegistrationNumber, LEGACY_CURVE);

  const hostMspId = generateMSPID(hostCert);
  const hostOut = resolveOutputDir(`full-pki-chain-msp-${hostMspId}`);
  mkdirSync(`${hostOut}/keystore`, { recursive: true });
  mkdirSync(`${hostOut}/signcerts`, { recursive: true });
  mkdirSync(`${hostOut}/cacerts`, { recursive: true });
  mkdirSync(`${hostOut}/intermediatecerts`, { recursive: true });

  writeFileSync(`${hostOut}/keystore/private-jwk.json`, JSON.stringify(hostKeyPair.jwk, null, 2));
  writeFileSync(`${hostOut}/signcerts/cert.pem`, bufferToPem(hostCertBuffer, 'CERTIFICATE'));
  writeFileSync(`${hostOut}/signcerts/cert.der`, hostCertBuffer);
  writeFileSync(`${hostOut}/cacerts/root-cert.pem`, bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync(`${hostOut}/intermediatecerts/ica-cert.pem`, bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(`${hostOut}/x509-chain.der`, Buffer.concat([hostCertBuffer, icaCert, rootCert]));
  const { d: _hostPriv, ...hostPubJwk } = hostKeyPair.jwk;
  await saveJwkDidAndCredential(hostCert, hostPubJwk, hostKeyPair.kid, hostOut);
}

generateCertificates().catch((error) => {
  console.error('Failed to generate PKI chain:', error);
  process.exit(1);
});
