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

type AuthorityConfig = {
  seed: Uint8Array;
  domain: string;
  subjectCN: string;
  org: string;
  jurisdiction: string;
  location?: { city: string; street: string; postalCode: string };
  certFile: string;
  jwksFile: string;
  didFile: string;
  sdFile: string;
};

const config: Record<'RootCA' | 'ICA', AuthorityConfig> = {
  RootCA: {
    seed: randomBytes(32),
    domain: 'rootca.example.com',
    subjectCN: 'UNID Root CA',
    org: 'Fundación UNID',
    jurisdiction: 'ES',
    location: { city: 'Soria', street: 'Calle Condes de Gómara, 6', postalCode: '42002' },
    certFile: 'root-certificate.pem',
    jwksFile: 'jwks-RootCA.json',
    didFile: 'did-RootCA.json',
    sdFile: 'Self-Description-RootCA.jsonld'
  },
  ICA: {
    seed: randomBytes(32),
    domain: 'ica.example.com',
    subjectCN: 'UNID ICA',
    org: 'UNID Intermediate CA',
    jurisdiction: 'ES',
    location: { city: 'Soria', street: 'Calle Condes de Gómara, 6', postalCode: '42002' },
    certFile: 'ica-certificate.pem',
    jwksFile: 'jwks-ICA.json',
    didFile: 'did-ICA.json',
    sdFile: 'Self-Description-ICA.jsonld'
  }
};

function bigintToBytes(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bufferToPem(buf: Buffer, label: string): string {
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function deriveKeyPair(seed: Uint8Array) {
  const scalarBytes = sha256(seed);
  const pub = p256.getPublicKey(scalarBytes, false); // 0x04 || X || Y
  const x = Buffer.from(pub.slice(1, 33)).toString('base64url');
  const y = Buffer.from(pub.slice(33)).toString('base64url');
  const d = Buffer.from(scalarBytes).toString('base64url');
  const scalar = BigInt('0x' + Buffer.from(scalarBytes).toString('hex'));
  return { scalar, pub, jwk: { kty: 'EC', crv: 'P-256', x, y, d } };
}

async function createCertificate(
  subjectCN: string,
  issuerCN: string,
  subjectKey: CryptoKey,
  issuerKey: CryptoKey,
  publicKeyBytes: Uint8Array,
  serial: number,
  years: number
) {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: serial });

  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: issuerCN })
  }));

  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: subjectCN })
  }));

  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date();
  cert.notAfter.value.setFullYear(cert.notBefore.value.getFullYear() + years);

  const publicKeyUint8Array = new Uint8Array(publicKeyBytes); // rewrap with real ArrayBuffer
  const pubKey = await webcrypto.subtle.importKey(
    'raw',
    publicKeyUint8Array,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
  await cert.subjectPublicKeyInfo.importKey(pubKey);

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

test('📜 Generate RootCA + ICA certs, fingerprints, jwks, did, SD', async () => {
  const keys: Record<'RootCA' | 'ICA', any> = {
      RootCA: undefined,
      ICA: undefined
  };

  for (const role of ['RootCA', 'ICA'] as const) {
    const { seed, subjectCN, domain, org, jurisdiction, location, jwksFile, didFile, sdFile } = config[role];
    const { scalar, pub, jwk } = deriveKeyPair(seed);

    const { d, ...publicJwkNoKid } = jwk;
    const thumb = await calculateJwkThumbprint(publicJwkNoKid, 'sha256');
    const kid = Buffer.from(thumb).toString('base64url');
    const fingerprint = Buffer.from(thumb).toString('hex');
    const publicJwk = { ...publicJwkNoKid, kid };

    console.log(`🔐 ${role} Seed:`, Buffer.from(seed).toString('hex'));
    console.log(`🆔 ${role} kid:`, kid);
    console.log(`📌 ${role} fingerprint:`, fingerprint);

    keys[role] = {
      private: await webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
      public: pub,
      subjectCN,
      org
    };

    fs.writeFileSync(jwksFile, JSON.stringify({ keys: [publicJwk] }, null, 2));
    fs.writeFileSync(didFile, JSON.stringify({
      '@context': 'https://www.w3.org/ns/did/v1',
      id: `did:web:${domain}`,
      verificationMethod: [{
        id: `did:web:${domain}#${kid}`,
        type: 'JsonWebKey2020',
        controller: `did:web:${domain}`,
        publicKeyJwk: publicJwk
      }],
      authentication: [`did:web:${domain}#${kid}`]
    }, null, 2));

    const headquarter = location ? {
      "gx:headquarterAddress": {
        "gx:country": jurisdiction,
        "gx:city": location.city,
        "gx:street": location.street,
        "gx:postalCode": location.postalCode
      }
    } : {};

    fs.writeFileSync(sdFile, JSON.stringify({
      "@context": [
        "https://w3id.org/gaia-x/contexts/self-description.jsonld",
        { "gx": "https://gaia-x.eu/ontology#", "schema": "http://schema.org/" }
      ],
      "@id": `did:web:${domain}`,
      "@type": "gx:Participant",
      "gx:legalName": org,
      "gx:jurisdiction": jurisdiction,
      ...headquarter,
      "gx:sector": ["Trust Infrastructure", "Blockchain", "Digital Identity"],
      "gx:gxfsRole": "gx:TrustAnchor",
      "gx:trustFramework": {
        "gx:conformantTo": [
          "https://ec.europa.eu/digital-building-blocks/eidas",
          "https://www.etsi.org/deliver/etsi_en/319411_1"
        ],
        "gx:certificates": [{
          "@type": "gx:Certificate",
          "gx:certificateType": role === 'RootCA' ? 'RootCA' : 'ICA',
          "gx:certificateIssuer": org,
          "gx:certificateSubject": `CN=${subjectCN}`,
          "gx:certificateURL": `https://${domain}/trust/${role}-certificate.crt`,
          "gx:fingerprint": `sha256:${fingerprint}`
        }]
      },
      "gx:roles": [{
        "@type": "gx:ServiceProviderRole",
        "gx:providedService": {
          "@type": "gx:TrustService",
          "gx:serviceType": role === 'RootCA' ? 'Root Certificate Authority' : 'Intermediate Certificate Authority',
          "gx:serviceEndpoint": `https://${domain}/trust`,
          "gx:policy": `https://${domain}/trust/cps-v1.pdf`,
          "gx:description": `${role} Gaia-X Trust Anchor`
        }
      }],
      "gx:participantLegalRepresentative": {
        "schema:name": "John Doe",
        "schema:email": "contact@example.com"
      },
      "gx:termsAndConditions": `https://${domain}/trust/terms`,
      "gx:dataProtectionRegime": "GDPR",
      "gx:didDocument": `https://${domain}/.well-known/did.json`,
      "gx:jwksUri": `https://${domain}/.well-known/jwks.json`
    }, null, 2));
  }

  // Certificates
  const rootCert = await createCertificate(
    keys.RootCA.subjectCN,
    keys.RootCA.subjectCN,
    keys.RootCA.private,
    keys.RootCA.private,
    keys.RootCA.public,
    1,
    10
  );
  fs.writeFileSync(config.RootCA.certFile, bufferToPem(rootCert, 'CERTIFICATE'));

  const icaCert = await createCertificate(
    keys.ICA.subjectCN,
    keys.RootCA.subjectCN,
    keys.ICA.private,
    keys.RootCA.private,
    keys.ICA.public,
    2,
    5
  );
  fs.writeFileSync(config.ICA.certFile, bufferToPem(icaCert, 'CERTIFICATE'));

  console.log('✅ All RootCA + ICA certs and trust metadata written.');
});
