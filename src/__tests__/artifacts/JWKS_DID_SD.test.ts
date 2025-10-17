import { createGaiaXLegalParticipantCredential } from '../../utils/credential-generators';
import { writeFileSync } from 'fs';
import { randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import { calculateJwkThumbprint } from 'jose';
import { TEST_ISSUER, TEST_PARTICIPANT, TEST_TERMS_AND_CONDITIONS } from '../data/participant';

const FILE_PREFIX = 'jwk-p256-seed';

function bigintToBytes(bn: bigint, length: number): Uint8Array {
  const hex = bn.toString(16).padStart(length * 2, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

test('Generate JWK from noble P-256 seed and export JWKS, DID and Legal Participant Credential', async () => {
  const seed = randomBytes(32);
  const seedHex = Buffer.from(seed).toString('hex');
  // console.log('🔐 Seed (hex):', seedHex);

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

  // console.log('🆔 kid (base64url):', kid);

  // Save public key JWK
  const jwks = { keys: [publicJwk] };
  writeFileSync(`artifacts/${FILE_PREFIX}-jwks.json`, JSON.stringify(jwks, null, 2));

  // Create DID
  const did = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: TEST_ISSUER.DID,
    verificationMethod: [
      {
        id: `${TEST_ISSUER.DID}#${kid}`,
        type: 'JsonWebKey2020',
        controller: TEST_ISSUER.DID,
        publicKeyJwk: publicJwk
      }
    ],
    authentication: [`${TEST_ISSUER.DID}#${kid}`]
  };
  writeFileSync(`artifacts/${FILE_PREFIX}-did.json`, JSON.stringify(did, null, 2));

  // Create Gaia-X Legal Participant Credential
  const credential = createGaiaXLegalParticipantCredential({
    webDomain: `https://${TEST_PARTICIPANT.WEB_DOMAIN}`,
    officialName: TEST_PARTICIPANT.OFFICIAL_NAME,
    did: did.id,
    issuerDid: did.id, // Self-issued for this test case
    vatId: TEST_PARTICIPANT.VAT_ID,
    countryCode: TEST_PARTICIPANT.COUNTRY_CODE,
    termsAndConditionsUrl: TEST_TERMS_AND_CONDITIONS.URL,
    termsAndConditionsHashHex: Buffer.from(sha256(Buffer.from(TEST_TERMS_AND_CONDITIONS.DUMMY_CONTENT, 'utf8'))).toString('hex'),
  });

  writeFileSync(`artifacts/${FILE_PREFIX}-credential-${TEST_PARTICIPANT.COMMON_NAME}.jsonld`, JSON.stringify(credential, null, 2));
  // console.log('✅ JWK, JWKS, DID and Legal Participant Credential generated successfully.');
});
