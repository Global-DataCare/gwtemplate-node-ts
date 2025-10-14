import { writeFileSync } from 'fs';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import { Crypto } from '@peculiar/webcrypto';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { TEST_PARTICIPANT } from '../data/participant';

const FILE_PREFIX = 'x509-self-signed';

const webcrypto = new Crypto();
pkijs.setEngine('nodeEngine', webcrypto, webcrypto.subtle);

function bigintToBytes(bn: bigint, length: number): Uint8Array {
  const hex = bn.toString(16).padStart(length * 2, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bufferToPem(buf: Buffer, label: string): string {
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

test('✅ Generate X.509 from noble-derived P-256 key with pkijs only', async () => {
  // Step 1: Generate key from seed
  const seed = randomBytes(32);
  const privateScalarBytes = sha256(seed);
  const privateScalar = BigInt('0x' + Buffer.from(privateScalarBytes).toString('hex'));
  const publicKeyBytes = p256.getPublicKey(privateScalarBytes, false); // uncompressed

  // Step 2: Import private key using raw EC format (manually constructed JWK unsupported)
  const privateKeyBytes = privateScalarBytes;

  const rawPrivateKeyJwk = {
    kty: 'EC',
    crv: 'P-256',
    d: Buffer.from(privateKeyBytes).toString('base64url'),
    x: Buffer.from(publicKeyBytes.slice(1, 33)).toString('base64url'),
    y: Buffer.from(publicKeyBytes.slice(33)).toString('base64url'),
  };

  const importedPrivateKey = await webcrypto.subtle.importKey(
    'jwk',
    rawPrivateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
// Fuerza el buffer real de 65 bytes (0x04 + x + y)
const rawPublicKey = new Uint8Array(publicKeyBytes); // <-- reenvuelve para que .buffer sea ArrayBuffer

  const importedPublicKey = await webcrypto.subtle.importKey(
    'raw',
    rawPublicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );

  // Step 3: Create and sign cert
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3', // Common Name
    value: new asn1js.PrintableString({ value: `${TEST_PARTICIPANT.COMMON_NAME} Root CA` })
  }));
  cert.subject.typesAndValues = cert.issuer.typesAndValues;
  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date();
  cert.notAfter.value.setFullYear(cert.notBefore.value.getFullYear() + 1);
  await cert.subjectPublicKeyInfo.importKey(importedPublicKey);
  cert.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.19',
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false)
    }),
  ];

  await cert.sign(importedPrivateKey, 'SHA-256');

  // Step 4: Export as PEM
  const certRaw = cert.toSchema(true).toBER(false);
  const certPem = bufferToPem(Buffer.from(certRaw), 'CERTIFICATE');
  writeFileSync(`artifacts/${FILE_PREFIX}-certificate.pem`, certPem);
  console.log(`✅ artifacts/${FILE_PREFIX}-certificate.pem written successfully.`);
});
