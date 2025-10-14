// scripts/seed-dev-cas.ts
import 'dotenv/config'; // Load .env file at the very top
import fs from 'fs';
import path from 'path';
import * as pkijs from 'pkijs';
import { Crypto } from '@peculiar/webcrypto';
import {
  AuthorityConfig,
  deriveKeyPair,
  createCertificate,
  bufferToPem,
  saveJwkDidAndSD,
} from '../src/utils/pki';

// Initialize WebCrypto
const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

// Helper function to assert that an environment variable is set
function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing environment variable: ${key}. Please check your .env file.`);
    process.exit(1);
  }
  return value;
}

// Load all configuration from environment variables
const ROOT_CA_SEED = getEnv('ROOT_CA_SEED');
const ICA_SEED = getEnv('ICA_SEED');
const BASE_DOMAIN = getEnv('BASE_DOMAIN');
const ORG_JURISDICTION = getEnv('ORG_JURISDICTION');
const ORG_CITY = getEnv('ORG_CITY');
const ORG_STREET = getEnv('ORG_STREET');
const ORG_POSTAL_CODE = getEnv('ORG_POSTAL_CODE');

// Define entity configurations using environment variables
const rootCAConfig: AuthorityConfig = {
  legalRegistrationNumber: getEnv('ROOT_CA_LEGAL_NUMBER'),
  domain: `root-ca.${BASE_DOMAIN}`,
  subjectCN: `root-ca.${BASE_DOMAIN}`,
  org: getEnv('ROOT_CA_ORG_NAME'),
  jurisdiction: ORG_JURISDICTION,
  location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
  seed: ROOT_CA_SEED,
};

const icaConfig: AuthorityConfig = {
  legalRegistrationNumber: getEnv('ICA_LEGAL_NUMBER'),
  domain: `ica.${BASE_DOMAIN}`,
  subjectCN: `ica.${BASE_DOMAIN}`,
  org: getEnv('ICA_ORG_NAME'),
  jurisdiction: ORG_JURISDICTION,
  location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
  seed: ICA_SEED,
};

const hostConfig: AuthorityConfig = {
    legalRegistrationNumber: getEnv('HOST_LEGAL_NUMBER'),
    domain: getEnv('HOST_DOMAIN'),
    subjectCN: getEnv('HOST_DOMAIN'),
    org: getEnv('HOST_ORG_NAME'),
    jurisdiction: ORG_JURISDICTION,
    location: { city: ORG_CITY, street: ORG_STREET, postalCode: ORG_POSTAL_CODE },
    seed: getEnv('HOST_SEED'),
  };


function resolveOutputDir(...segments: string[]) {
    const dir = path.join(...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

async function generateEntityArtifacts(
    config: AuthorityConfig,
    outputDir: string,
    role: "TrustAnchor" | "DataConsumer" | "ServiceProvider",
    sector: string[]
  ) {
    const { jwk, kid } = await deriveKeyPair(config.seed);
    const { d: _, ...pubJwk } = jwk;
  
    await saveJwkDidAndSD(
      config,
      pubJwk,
      kid,
      outputDir,
      role,
      sector
    );
    // Save the private key separately for the entity to use
    fs.writeFileSync(path.join(outputDir, 'private-jwk.json'), JSON.stringify(jwk, null, 2));
    console.log(`✅ Identity artifacts for ${config.domain} generated in ${outputDir}`);
}

// --- ENTITY CONFIGURATION ---
// This central configuration drives the entire script.
// To add a new entity, just add its configuration here.
const ENTITIES_CONFIG = [
  {
    hostname: 'root-ca',
    role: 'TrustAnchor',
    sector: ['Trust Infrastructure'],
    config: {
      legalRegistrationNumber: getEnv('ROOT_CA_LEGAL_NUMBER'),
      domain: `root-ca.${getEnv('BASE_DOMAIN')}`,
      subjectCN: `root-ca.${getEnv('BASE_DOMAIN')}`,
      org: getEnv('ROOT_CA_ORG_NAME'),
      jurisdiction: getEnv('ORG_JURISDICTION'),
      location: { city: getEnv('ORG_CITY'), street: getEnv('ORG_STREET'), postalCode: getEnv('ORG_POSTAL_CODE') },
      seed: getEnv('ROOT_CA_SEED'),
    }
  },
  {
    hostname: 'intermediate-ca',
    role: 'TrustAnchor',
    sector: ['Trust Infrastructure'],
    config: {
      legalRegistrationNumber: getEnv('ICA_LEGAL_NUMBER'),
      domain: `ica.${getEnv('BASE_DOMAIN')}`,
      subjectCN: `ica.${getEnv('BASE_DOMAIN')}`,
      org: getEnv('ICA_ORG_NAME'),
      jurisdiction: getEnv('ORG_JURISDICTION'),
      location: { city: getEnv('ORG_CITY'), street: getEnv('ORG_STREET'), postalCode: getEnv('ORG_POSTAL_CODE') },
      seed: getEnv('ICA_SEED'),
    }
  },
  {
    hostname: 'host-b',
    role: 'ServiceProvider',
    sector: ['Public Services'],
    config: {
      legalRegistrationNumber: getEnv('HOST_LEGAL_NUMBER'),
      domain: getEnv('HOST_DOMAIN'),
      subjectCN: getEnv('HOST_DOMAIN'),
      org: getEnv('HOST_ORG_NAME'),
      jurisdiction: getEnv('ORG_JURISDICTION'),
      location: { city: getEnv('ORG_CITY'), street: getEnv('ORG_STREET'), postalCode: getEnv('ORG_POSTAL_CODE') },
      seed: getEnv('HOST_SEED'),
    }
  },
  // To add more entities like tenant-c, controller-r, etc.,
  // add their environment variables and configuration blocks here.
];


// ... (resolveOutputDir, generateEntityArtifacts functions)

async function generateCryptoMaterial() {
  console.log('🔥 Starting generation of crypto material for development environment...');

  // --- Setup Directories ---
  const FABRIC_CA_ROOT_DIR = resolveOutputDir('fabric-ca-server-root');
  const FABRIC_CA_ICA_DIR = resolveOutputDir('fabric-ca-server-ica');
  const ARTIFACTS_DIR = resolveOutputDir('artifacts');
  
  console.log('🧹 Cleaning up previous crypto material...');
  fs.rmSync(FABRIC_CA_ROOT_DIR, { recursive: true, force: true });
  fs.rmSync(FABRIC_CA_ICA_DIR, { recursive: true, force: true });
  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(FABRIC_CA_ROOT_DIR, { recursive: true });
  fs.mkdirSync(FABRIC_CA_ICA_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const cryptoCache = new Map<string, { keyPair: any, privateKey: CryptoKey, certBuffer: Buffer }>();

  // --- ROOT CA ---
  const rootEntity = ENTITIES_CONFIG.find(e => e.hostname === 'root-ca')!;
  console.log(`🌱 Generating ${rootEntity.hostname}...`);

  const rootKeyPair = await deriveKeyPair(rootEntity.config.seed);
  const rootPrivKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const rootCertBuffer = await createCertificate(
    rootEntity.config.subjectCN, rootEntity.config.subjectCN, rootPrivKey, rootPrivKey, rootKeyPair.pub, 10, rootEntity.config.legalRegistrationNumber
  );
  cryptoCache.set(rootEntity.hostname, { keyPair: rootKeyPair, privateKey: rootPrivKey, certBuffer: rootCertBuffer });

  fs.writeFileSync(path.join(FABRIC_CA_ROOT_DIR, 'ca-cert.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
  const rootPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', rootPrivKey)), 'PRIVATE KEY');
  fs.writeFileSync(path.join(FABRIC_CA_ROOT_DIR, 'ca-key.pem'), rootPrivKeyPem);
  console.log(`✅ Fabric CA material for ${rootEntity.hostname} generated in ${FABRIC_CA_ROOT_DIR}`);
  
  const rootArtifactsDir = resolveOutputDir(ARTIFACTS_DIR, rootEntity.hostname);
  await generateEntityArtifacts(rootEntity.config, rootArtifactsDir, rootEntity.role as any, rootEntity.sector);

  // --- INTERMEDIATE CA ---
  const icaEntity = ENTITIES_CONFIG.find(e => e.hostname === 'intermediate-ca')!;
  console.log(`🌿 Generating ${icaEntity.hostname}...`);
  
  const icaKeyPair = await deriveKeyPair(icaEntity.config.seed);
  const icaPrivKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const icaCertBuffer = await createCertificate(
    icaEntity.config.subjectCN, rootEntity.config.subjectCN, icaPrivKey, rootPrivKey, icaKeyPair.pub, 5, icaEntity.config.legalRegistrationNumber
  );
  cryptoCache.set(icaEntity.hostname, { keyPair: icaKeyPair, privateKey: icaPrivKey, certBuffer: icaCertBuffer });

  fs.writeFileSync(path.join(FABRIC_CA_ICA_DIR, 'ca-cert.pem'), bufferToPem(icaCertBuffer, 'CERTIFICATE'));
  const icaPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', icaPrivKey)), 'PRIVATE KEY');
  fs.writeFileSync(path.join(FABRIC_CA_ICA_DIR, 'ca-key.pem'), icaPrivKeyPem);
  fs.writeFileSync(path.join(FABRIC_CA_ICA_DIR, 'ca-chain.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
  console.log(`✅ Fabric CA material for ${icaEntity.hostname} generated in ${FABRIC_CA_ICA_DIR}`);
  
  const icaArtifactsDir = resolveOutputDir(ARTIFACTS_DIR, icaEntity.hostname);
  await generateEntityArtifacts(icaEntity.config, icaArtifactsDir, icaEntity.role as any, icaEntity.sector);

  // --- OTHER ENTITIES (HOST, TENANTS, etc.) ---
  for (const entity of ENTITIES_CONFIG) {
    if (entity.hostname === 'root-ca' || entity.hostname === 'intermediate-ca') continue;

    console.log(`💻 Generating ${entity.hostname}...`);
    const { keyPair, privateKey } = cryptoCache.get(entity.hostname) || { 
        keyPair: await deriveKeyPair(entity.config.seed), 
        privateKey: await crypto.subtle.importKey('jwk', (await deriveKeyPair(entity.config.seed)).jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
    };
    
    const certBuffer = await createCertificate(
      entity.config.subjectCN, icaEntity.config.subjectCN, privateKey, icaPrivKey, keyPair.pub, 2, entity.config.legalRegistrationNumber
    );
    cryptoCache.set(entity.hostname, { keyPair, privateKey, certBuffer });
    
    const entityArtifactsDir = resolveOutputDir(ARTIFACTS_DIR, entity.hostname);
    fs.writeFileSync(path.join(entityArtifactsDir, 'cert.pem'), bufferToPem(certBuffer, 'CERTIFICATE'));
    console.log(`✅ X.509 certificate for ${entity.hostname} generated in ${entityArtifactsDir}`);
    await generateEntityArtifacts(entity.config, entityArtifactsDir, entity.role as any, entity.sector);
  }

  console.log('\n🚀 Crypto material generated successfully. You can now start the CAs with `docker-compose up -d`.');
}

generateCryptoMaterial().catch(err => {
  console.error('❌ Failed to generate crypto material:', err);
  process.exit(1);
});
