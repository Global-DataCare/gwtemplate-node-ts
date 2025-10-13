import fs from 'fs';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import { calculateJwkThumbprint } from 'jose';

const webDomainCA = 'example.com';
const officialNameOrg = 'Example Company';
const commonNameOrg = 'Company';
const certificateSubjectCN = 'Company Root CA';
const certType = 'root';
const certificateType = 'RootCA';
const validForYears = 1;

function bigintToBytes(bn: bigint, length: number): Uint8Array {
  const hex = bn.toString(16).padStart(length * 2, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

test('Generate JWK from noble P-256 seed and export JWKS, DID and SD', async () => {
  const seed = randomBytes(32);
  const seedHex = Buffer.from(seed).toString('hex');
  console.log('🔐 Seed (hex):', seedHex);

  const privateScalarBytes = sha256(seed);
  const pub = p256.getPublicKey(privateScalarBytes, false);

  const P256_LEN = 32;
  const x = Buffer.from(pub.slice(1, 1 + P256_LEN)).toString('base64url');
  const y = Buffer.from(pub.slice(1 + P256_LEN)).toString('base64url');
  const d = Buffer.from(privateScalarBytes).toString('base64url');

  const privateJwk = {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d
  };

  // Calculate thumbprint and use as kid
  const { d: _, ...publicJwkNoKid } = privateJwk;
  const thumbprint = await calculateJwkThumbprint(publicJwkNoKid, 'sha256');
  const kid = Buffer.from(thumbprint).toString('base64url');
  const publicJwk = { ...publicJwkNoKid, kid };

  console.log('🆔 kid (base64url):', kid);

  // Save public key JWK
  const jwks = { keys: [publicJwk] };
  fs.writeFileSync('jwks.json', JSON.stringify(jwks, null, 2));

  // Create DID
  const did = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: `did:web:${webDomainCA}`,
    verificationMethod: [
      {
        id: `did:web:${webDomainCA}#${kid}`,
        type: 'JsonWebKey2020',
        controller: `did:web:${webDomainCA}`,
        publicKeyJwk: publicJwk
      }
    ],
    authentication: [`did:web:${webDomainCA}#${kid}`]
  };
  fs.writeFileSync('did.json', JSON.stringify(did, null, 2));

  // Create Gaia-X Self-Description
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
      "gx:certificates": [
        {
          "@type": "gx:Certificate",
          "gx:certificateType": certificateType,
          "gx:certificateIssuer": officialNameOrg,
          "gx:certificateSubject": `CN=${certificateSubjectCN}`,
          "gx:certificateURL": `https://${webDomainCA}/trust/${certType}-certificate.crt`,
          "gx:fingerprint": `sha256:${Buffer.from(thumbprint).toString('hex')}`
        }
      ]
    },
    "gx:roles": [
      {
        "@type": "gx:ServiceProviderRole",
        "gx:providedService": {
          "@type": "gx:TrustService",
          "gx:serviceType": "Root Certificate Authority",
          "gx:serviceEndpoint": `https://${webDomainCA}/trust`,
          "gx:policy": `https://${webDomainCA}/trust/cps-v1.pdf`,
          "gx:description": "Root CA for a Hyperledger Fabric-based data space."
        }
      }
    ],
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
  console.log('✅ JWK, JWKS, DID and SD generated successfully.');
});
