// src/__tests__/setup/seedDevCAs.test.ts

import 'dotenv/config'; // Load .env file
import fs from 'fs';
import path from 'path';
import * as pkijs from 'pkijs';
import { Crypto } from '@peculiar/webcrypto';
import {
  EntityConfig,
  deriveKeyPair,
  createCertificate,
  bufferToPem,
} from '../../utils/pki-utils';

// Increase timeout for this test suite as key generation can be slow
jest.setTimeout(30000); 

const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}. Please check your .env file.`);
  }
  return value;
}

const ROOT_CA_SEED = getEnv('ROOT_CA_SEED');
const ICA_SEED = getEnv('ICA_SEED');
const BASE_DOMAIN = getEnv('BASE_DOMAIN');
// ... (load other env vars)

const rootCAConfig: EntityConfig = {
  // ... (config loaded from env)
  legalRegistrationNumber: getEnv('ROOT_CA_LEGAL_NUMBER'),
  domain: `root-ca.${BASE_DOMAIN}`,
  subjectCN: `root-ca.${BASE_DOMAIN}`,
  org: getEnv('ROOT_CA_ORG_NAME'),
  jurisdiction: getEnv('ORG_JURISDICTION'),
  location: { city: getEnv('ORG_CITY'), street: getEnv('ORG_STREET'), postalCode: getEnv('ORG_POSTAL_CODE') },
  seed: ROOT_CA_SEED,
};

const icaConfig: EntityConfig = {
  // ... (config loaded from env)
  legalRegistrationNumber: getEnv('ICA_LEGAL_NUMBER'),
  domain: `ica.${BASE_DOMAIN}`,
  subjectCN: `ica.${BASE_DOMAIN}`,
  org: getEnv('ICA_ORG_NAME'),
  jurisdiction: getEnv('ORG_JURISDICTION'),
  location: { city: getEnv('ORG_CITY'), street: getEnv('ORG_STREET'), postalCode: getEnv('ORG_POSTAL_CODE') },
  seed: ICA_SEED,
};

function resolveOutputDir(...segments: string[]) {
    const dir = path.join(process.cwd(), ...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

describe('Development CAs Seeding', () => {
  it('should generate all required crypto material for Root CA and Intermediate CA', async () => {
    console.log('🔥 Starting generation of crypto material for development CAs...');

    const rootDir = resolveOutputDir('fabric-ca-server-root');
    const icaDir = resolveOutputDir('fabric-ca-server-ica');
    
    console.log('🧹 Cleaning up previous crypto material...');
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(icaDir, { recursive: true, force: true });
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(icaDir, { recursive: true });

    // --- Root CA ---
    console.log('🌱 Generating Root CA...');
    const rootKeyPair = await deriveKeyPair(rootCAConfig.seed);
    const rootPrivKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    
    const rootCertBuffer = await createCertificate(
      rootCAConfig.subjectCN,
      rootCAConfig.subjectCN,
      rootPrivKey,
      rootPrivKey,
      rootKeyPair.pub,
      10,
      rootCAConfig.legalRegistrationNumber
    );

    fs.writeFileSync(path.join(rootDir, 'ca-cert.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
    const rootPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', rootPrivKey)), 'PRIVATE KEY');
    fs.writeFileSync(path.join(rootDir, 'ca-key.pem'), rootPrivKeyPem);
    console.log(`✅ Root CA material generated in ${rootDir}`);

    // --- Intermediate CA ---
    console.log('🌿 Generating Intermediate CA...');
    const icaKeyPair = await deriveKeyPair(icaConfig.seed);
    const icaPrivKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);

    const icaCertBuffer = await createCertificate(
      icaConfig.subjectCN,
      rootCAConfig.subjectCN,
      icaPrivKey,
      rootPrivKey,
      icaKeyPair.pub,
      5,
      icaConfig.legalRegistrationNumber
    );
    
    fs.writeFileSync(path.join(icaDir, 'ca-cert.pem'), bufferToPem(icaCertBuffer, 'CERTIFICATE'));
    const icaPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', icaPrivKey)), 'PRIVATE KEY');
    fs.writeFileSync(path.join(icaDir, 'ca-key.pem'), icaPrivKeyPem);
    fs.writeFileSync(path.join(icaDir, 'ca-chain.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
    
    console.log(`✅ Intermediate CA material generated in ${icaDir}`);
    console.log('\n🚀 Crypto material generated successfully. You can now start the CAs with \`docker-compose up -d\`.');
  });
});
