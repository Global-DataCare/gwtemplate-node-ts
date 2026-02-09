import 'dotenv/config';

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

import {
  bufferToPem,
  createCertificate,
  deriveKeyPair,
  saveJwkDidAndCredential,
} from '../src/utils/pki';
import { loadOrganizationIdentity } from '../src/utils/organization-json';
import { confirmOverwrite, getArgValue, getEnvName, loadKdfConfig, promptSeed } from './utils/pki-script-utils';

async function main() {
  const jsonPath = getArgValue('--json');
  if (!jsonPath) {
    throw new Error('Usage: generate-root-ca.ts --json <ca-organization.json> [--seed <hex>] [--env test|prod] [--kdf auto|scrypt|hash|context] [--context <name>] [--kdf-config <path>]');
  }

  const envName = getEnvName();
  const seedArg = getArgValue('--seed');
  const seed = seedArg ?? (await promptSeed('CA'));

  const { authority } = loadOrganizationIdentity(jsonPath, seed);
  const curve = 'P-384' as const;

  const keyPair = await deriveKeyPair(authority.seed as string, curve, loadKdfConfig());
  const { Crypto } = await import('@peculiar/webcrypto');
  const cryptoInstance = new Crypto();
  const privateKey = await cryptoInstance.subtle.importKey(
    'jwk',
    keyPair.jwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );

  const cert = await createCertificate(
    authority.subjectCN,
    authority.subjectCN,
    privateKey,
    privateKey,
    keyPair.pub,
    10,
    authority.legalRegistrationNumber,
    curve,
    true
  );

  const baseDir = path.join('artifacts', envName);
  const caServerDir = path.join(baseDir, 'fabric-ca-server-root');
  if (existsSync(caServerDir)) {
    await confirmOverwrite(caServerDir);
    rmSync(caServerDir, { recursive: true, force: true });
  }
  mkdirSync(caServerDir, { recursive: true });
  writeFileSync(path.join(caServerDir, 'ca-cert.pem'), bufferToPem(cert, 'CERTIFICATE'));
  writeFileSync(
    path.join(caServerDir, 'ca-key.pem'),
    bufferToPem(Buffer.from(await cryptoInstance.subtle.exportKey('pkcs8', privateKey)), 'PRIVATE KEY')
  );

  const outDir = path.join(baseDir, 'pki-root-ca');
  if (existsSync(outDir)) {
    await confirmOverwrite(outDir);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  writeFileSync(path.join(outDir, 'root-cert.pem'), bufferToPem(cert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'root-cert.der'), cert);
  writeFileSync(path.join(outDir, 'private-jwk.json'), JSON.stringify(keyPair.jwk, null, 2));
  const { d: _priv, ...pubJwk } = keyPair.jwk;
  await saveJwkDidAndCredential(authority, pubJwk, keyPair.kid, outDir);
}

main().catch((error) => {
  console.error('Failed to generate root CA:', error);
  process.exit(1);
});
