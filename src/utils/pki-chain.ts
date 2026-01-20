// src/utils/pki-chain.ts

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
} from './pki';

type PkiChainOptions = {
  cleanOutput?: boolean;
};

const EnvKeys = {
  ROOT_CA_DOMAIN: 'ROOT_CA_DOMAIN',
  ROOT_CA_JURISDICTION: 'ROOT_CA_JURISDICTION',
  ROOT_CA_CITY: 'ROOT_CA_CITY',
  ROOT_CA_STREET: 'ROOT_CA_STREET',
  ROOT_CA_POSTAL_CODE: 'ROOT_CA_POSTAL_CODE',
  ROOT_CA_LEGAL_ID_TYPE: 'ROOT_CA_LEGAL_ID_TYPE',
  ROOT_CA_LEGAL_ID_NUMBER: 'ROOT_CA_LEGAL_ID_NUMBER',
  ROOT_CA_LEGAL_NAME: 'ROOT_CA_LEGAL_NAME',
  ICA_DOMAIN: 'ICA_DOMAIN',
  ICA_JURISDICTION: 'ICA_JURISDICTION',
  ICA_CITY: 'ICA_CITY',
  ICA_STREET: 'ICA_STREET',
  ICA_POSTAL_CODE: 'ICA_POSTAL_CODE',
  ICA_LEGAL_ID_TYPE: 'ICA_LEGAL_ID_TYPE',
  ICA_LEGAL_ID_NUMBER: 'ICA_LEGAL_ID_NUMBER',
  ICA_LEGAL_NAME: 'ICA_LEGAL_NAME',
  HOST_JURISDICTION: 'HOST_JURISDICTION',
  HOST_CITY: 'HOST_CITY',
  HOST_STREET: 'HOST_STREET',
  HOST_POSTAL_CODE: 'HOST_POSTAL_CODE',
  HOST_ID_TYPE: 'HOST_ID_TYPE',
  HOST_ID_VALUE: 'HOST_ID_VALUE',
  HOST_LEGAL_ID_TYPE: 'HOST_LEGAL_ID_TYPE',
  HOST_LEGAL_ID_NUMBER: 'HOST_LEGAL_ID_NUMBER',
  HOST_LEGAL_NAME: 'HOST_LEGAL_NAME',
  HOST_DOMAIN: 'HOST_DOMAIN',
  HOST_CN: 'HOST_CN',
} as const;

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function buildLegalNumber(options: {
  region?: string;
  jurisdiction: string;
  idType: string;
  idValue: string;
}): string {
  const region = (options.region || '').toUpperCase();
  const jurisdiction = options.jurisdiction.toUpperCase();
  const idType = options.idType.toUpperCase();
  const idValue = options.idValue;
  const normalizedType = region === 'EU' && idType === 'TAX' ? 'VAT' : idType;

  if (region === 'EU' && normalizedType === 'VAT') {
    return `VAT${jurisdiction}-${idValue}`;
  }
  return `${normalizedType}-${idValue}`;
}

export async function generatePkiChainFromEnv(options?: PkiChainOptions): Promise<void> {
  const crypto = new Crypto();
  pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

  const ROOT_CA_DOMAIN = getEnv(EnvKeys.ROOT_CA_DOMAIN);
  const ICA_DOMAIN = getEnv(EnvKeys.ICA_DOMAIN);
  const ROOT_CA_JURISDICTION = getEnv(EnvKeys.ROOT_CA_JURISDICTION);
  const ROOT_CA_CITY = getEnv(EnvKeys.ROOT_CA_CITY);
  const ROOT_CA_STREET = getEnv(EnvKeys.ROOT_CA_STREET);
  const ROOT_CA_POSTAL_CODE = getEnv(EnvKeys.ROOT_CA_POSTAL_CODE);
  const ICA_JURISDICTION = getEnv(EnvKeys.ICA_JURISDICTION);
  const ICA_CITY = getEnv(EnvKeys.ICA_CITY);
  const ICA_STREET = getEnv(EnvKeys.ICA_STREET);
  const ICA_POSTAL_CODE = getEnv(EnvKeys.ICA_POSTAL_CODE);
  const HOST_JURISDICTION = getEnv(EnvKeys.HOST_JURISDICTION);
  const HOST_CITY = getEnv(EnvKeys.HOST_CITY);
  const HOST_STREET = getEnv(EnvKeys.HOST_STREET);
  const HOST_POSTAL_CODE = getEnv(EnvKeys.HOST_POSTAL_CODE);
  const HOST_ID_TYPE = getEnv(EnvKeys.HOST_ID_TYPE);
  const HOST_ID_VALUE = getEnv(EnvKeys.HOST_ID_VALUE);
  const HOST_REGION = process.env.HOST_REGION;
  const ROOT_CA_REGION = process.env.ROOT_CA_REGION;
  const ICA_REGION = process.env.ICA_REGION;
  const ROOT_CA_LEGAL_ID_TYPE = getEnv(EnvKeys.ROOT_CA_LEGAL_ID_TYPE);
  const ROOT_CA_LEGAL_ID_NUMBER = getEnv(EnvKeys.ROOT_CA_LEGAL_ID_NUMBER);
  const ICA_LEGAL_ID_TYPE = getEnv(EnvKeys.ICA_LEGAL_ID_TYPE);
  const ICA_LEGAL_ID_NUMBER = getEnv(EnvKeys.ICA_LEGAL_ID_NUMBER);
  const HOST_LEGAL_ID_TYPE = getEnv(EnvKeys.HOST_LEGAL_ID_TYPE);
  const HOST_LEGAL_ID_NUMBER = getEnv(EnvKeys.HOST_LEGAL_ID_NUMBER);

  const ROOT_CA_SEED = process.env.ROOT_CA_SEED || 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
  const ICA_SEED = process.env.ICA_SEED || '';
  const LEGACY_SIGN_ALG = (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
    ? process.env.LEGACY_SIGN_ALG
    : 'ES384';
  const LEGACY_CURVE: 'P-256' | 'P-384' = LEGACY_SIGN_ALG === 'ES384' ? 'P-384' : 'P-256';

  const rootCA: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: ROOT_CA_REGION,
      jurisdiction: ROOT_CA_JURISDICTION,
      idType: ROOT_CA_LEGAL_ID_TYPE,
      idValue: ROOT_CA_LEGAL_ID_NUMBER,
    }),
    domain: ROOT_CA_DOMAIN,
    subjectCN: ROOT_CA_DOMAIN,
    officialName: getEnv(EnvKeys.ROOT_CA_LEGAL_NAME),
    countryCode: ROOT_CA_JURISDICTION,
    location: { city: ROOT_CA_CITY, street: ROOT_CA_STREET, postalCode: ROOT_CA_POSTAL_CODE },
    seed: ROOT_CA_SEED,
  };

  const ica: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: ICA_REGION,
      jurisdiction: ICA_JURISDICTION,
      idType: ICA_LEGAL_ID_TYPE,
      idValue: ICA_LEGAL_ID_NUMBER,
    }),
    domain: ICA_DOMAIN,
    subjectCN: ICA_DOMAIN,
    officialName: getEnv(EnvKeys.ICA_LEGAL_NAME),
    countryCode: ICA_JURISDICTION,
    location: { city: ICA_CITY, street: ICA_STREET, postalCode: ICA_POSTAL_CODE },
    seed: ICA_SEED,
  };

  const hostCert: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: HOST_REGION,
      jurisdiction: HOST_JURISDICTION,
      idType: HOST_LEGAL_ID_TYPE,
      idValue: HOST_LEGAL_ID_NUMBER,
    }),
    domain: getEnv(EnvKeys.HOST_DOMAIN),
    subjectCN: getEnv(EnvKeys.HOST_CN),
    officialName: getEnv(EnvKeys.HOST_LEGAL_NAME),
    countryCode: HOST_JURISDICTION,
    location: { city: HOST_CITY, street: HOST_STREET, postalCode: HOST_POSTAL_CODE },
    seed: process.env.HOST_SEED || '',
  };

  if (options?.cleanOutput) {
    rmSync('fabric-ca-server-root', { recursive: true, force: true });
    rmSync('fabric-ca-server-ica', { recursive: true, force: true });
  }

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

  // Host / MSP
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
