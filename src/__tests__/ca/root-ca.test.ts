import fs from 'fs';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import { calculateJwkThumbprint } from 'jose';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { Crypto } from '@peculiar/webcrypto';

const webcrypto = new Crypto();
pkijs.setEngine('nodeEngine', webcrypto, webcrypto.subtle);

const webDomainCA = 'unid.es';
const certificateSubjectCN = 'UNID CA';
const officialNameOrg = 'FUNDACION UNID';
const commonNameOrg = 'UNID';
const certType = 'root';
const certificateType = 'RootCA';
const validForYears = 1;

function bigintToBytes(bn: bigint, length: number): Uint8Array {
  const hex = bn.toString(16).padStart(length * 2, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bufferToPem(buf: Buffer, label: string): string {
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

test('📜 Root CA Key, Fingerprint and Certificate', async () => {
  // 1. Generate seed and derive key
  const seed = randomBytes(32);
  const seedHex = Buffer.from(seed).toString('hex');
  const privateScalarBytes = sha256(seed);
  const privateScalar = BigInt('0x' + Buffer.from(privateScalarBytes).toString('hex'));
  const pub = p256.getPublicKey(privateScalarBytes, false);

  const P256_LEN = 32;
  const x = Buffer.from(pub.slice(1, 1 + P256_LEN)).toString('base64url');
  const y = Buffer.from(pub.slice(1 + P256_LEN)).toString('base64url');
  const d = Buffer.from(bigintToBytes(privateScalar, P256_LEN)).toString('base64url');

  const publicJwk = { kty: 'EC', crv: 'P-256', x, y };
  const thumbprint = await calculateJwkThumbprint(publicJwk, 'sha256');
  const kid = Buffer.from(thumbprint).toString('base64url');
  const thumbHex = Buffer.from(thumbprint).toString('hex');

  console.log('🔐 Seed (hex):', seedHex);
  console.log('🆔 kid (base64url):', kid);
  console.log('📌 CA Root Fingerprint (SHA-256):', thumbHex);

  // 2. Export public key JWK with kid
  const publicJwkWithKid = { ...publicJwk, kid };
  const jwks = { keys: [publicJwkWithKid] };
  fs.writeFileSync('jwks.json', JSON.stringify(jwks, null, 2));

  const did = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: `did:web:${webDomainCA}`,
    verificationMethod: [{
      id: `did:web:${webDomainCA}#${kid}`,
      type: 'JsonWebKey2020',
      controller: `did:web:${webDomainCA}`,
      publicKeyJwk: publicJwkWithKid
    }],
    authentication: [`did:web:${webDomainCA}#${kid}`]
  };
  fs.writeFileSync('did.json', JSON.stringify(did, null, 2));

  const sd = {
    "@context": [
      "https://w3id.org/gaia-x/contexts/self-description.jsonld",
      { "gx": "https://gaia-x.eu/ontology#", "schema": "http://schema.org/" }
    ],
    "@id": did.id,
    "@type": "gx:Participant",
    "gx:legalName": officialNameOrg,
    "gx:jurisdiction": "ES",
    "gx:sector": ["Trust Infrastructure", "Blockchain", "Digital Identity"],
    "gx:gxfsRole": "gx:TrustAnchor",
    "gx:trustFramework": {
      "gx:conformantTo": [
        "https://ec.europa.eu/digital-building-blocks/eidas",
        "https://www.etsi.org/deliver/etsi_en/319411_1"
      ],
      "gx:certificates": [{
        "@type": "gx:Certificate",
        "gx:certificateType": certificateType,
        "gx:certificateIssuer": officialNameOrg,
        "gx:certificateSubject": `CN=${certificateSubjectCN}`,
        "gx:certificateURL": `https://${webDomainCA}/trust/${certType}-certificate.crt`,
        "gx:fingerprint": `sha256:${thumbHex}`
      }]
    },
    "gx:roles": [{
      "@type": "gx:ServiceProviderRole",
      "gx:providedService": {
        "@type": "gx:TrustService",
        "gx:serviceType": "Root Certificate Authority",
        "gx:serviceEndpoint": `https://${webDomainCA}/trust`,
        "gx:policy": `https://${webDomainCA}/trust/cps-v1.pdf`,
        "gx:description": "Root CA for a Hyperledger Fabric-based data space."
      }
    }],
    "gx:participantLegalRepresentative": {
      "schema:name": "John Doe",
      "schema:email": "contact@example.com"
    },
    "gx:termsAndConditions": `https://${webDomainCA}/trust/terms`,
    "gx:dataProtectionRegime": "GDPR",
    "gx:didDocument": `https://${webDomainCA}/.well-known/did.json`,
    "gx:jwksUri": `https://${webDomainCA}/.well-known/jwks.json`
  };
  fs.writeFileSync(`Self-Description-${commonNameOrg}.jsonld`, JSON.stringify(sd, null, 2));

  // 3. Generate certificate with pkijs
  const rawPub = p256.getPublicKey(privateScalarBytes, false);
  const rawPriv = privateScalarBytes;

  const privateJwk = { kty: 'EC', crv: 'P-256', x, y, d };
  const cryptoKeyPriv = await webcrypto.subtle.importKey(
    'jwk', privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, ['sign']
  );

  const cryptoKeyPub = await webcrypto.subtle.importKey(
    'raw', new Uint8Array(rawPub),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, ['verify']
  );

  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: 'Example Root CA' })
  }));
  cert.subject.typesAndValues = cert.issuer.typesAndValues;
  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date();
  cert.notAfter.value.setFullYear(cert.notBefore.value.getFullYear() + validForYears);
  await cert.subjectPublicKeyInfo.importKey(cryptoKeyPub);
  cert.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.19',
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false)
    })
  ];

  await cert.sign(cryptoKeyPriv, 'SHA-256');
  const certRaw = cert.toSchema(true).toBER(false);
  const certPem = bufferToPem(Buffer.from(certRaw), 'CERTIFICATE');
  fs.writeFileSync('certificate-pkijs.pem', certPem);

  console.log('📄 certificate-pkijs.pem written successfully.');
});
