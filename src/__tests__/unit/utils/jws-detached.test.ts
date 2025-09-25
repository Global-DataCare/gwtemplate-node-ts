import { externalClientSignerJwk } from '../../data/external-client.data';
import * as mlDsa from '@noble/post-quantum/ml-dsa';
import { withKid } from '../../../crypto/jwk-thumbprint';
import { Content } from '../../../utils/content';
import { MldsaPublicJwk } from '../../../crypto/interfaces/Cryptography.types';
import { encodeHeader, encodePayload, encodeSignature, decodeHeader } from '../../../utils/jwt';

// Define a type for the private key for clarity and type safety.
type MldsaPrivateJwk = MldsaPublicJwk & { priv: string };

// --- Local Implementation for Testing ---
// The functions under test are implemented directly here, as requested.
// They will be moved to a service like KmsService later.

/**
 * (Local Test Implementation) Creates a detached JWS.
 */
async function signDetached(payload: object, privateKey: MldsaPrivateJwk): Promise<string> {
  const header = {
    alg: privateKey.alg,
    // The public key's kid should be in the private key object for convenience
    kid: (privateKey as any).kid,
    typ: 'JWT'
  };

  const encodedHeader = encodeHeader(header);
  const encodedPayload = await encodePayload(payload);

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signingInputBytes = Content.stringToBytesUTF8(signingInput);

  const privateKeyBytes = Content.base64ToBytes(privateKey.priv);

  const signatureBytes = await mlDsa.ml_dsa44.sign(signingInputBytes, privateKeyBytes);
  const encodedSignature = encodeSignature(signatureBytes);

  return `${encodedHeader}..${encodedSignature}`;
}

/**
 * (Local Test Implementation) Verifies a detached JWS.
 */
async function verifyDetached(detachedJws: string, payload: object, publicKey: MldsaPublicJwk): Promise<boolean> {
  const parts = detachedJws.split('.');
  if (parts.length !== 3 || parts[1] !== '') {
    throw new Error('Invalid detached JWS format');
  }
  const [encodedHeader, , encodedSignature] = parts;

  const header = decodeHeader(encodedHeader);
  if (header.alg !== publicKey.alg) {
    throw new Error(`Algorithm mismatch: JWS header has ${header.alg}, key has ${publicKey.alg}`);
  }
  if (header.kid !== publicKey.kid) {
      throw new Error('Key ID mismatch');
  }

  const encodedPayload = await encodePayload(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signingInputBytes = Content.stringToBytesUTF8(signingInput);

  const signatureBytes = Content.base64ToBytes(encodedSignature);
  const publicKeyBytes = Content.base64ToBytes(publicKey.pub);

  const isValid = await mlDsa.ml_dsa44.verify(signatureBytes, signingInputBytes, publicKeyBytes);

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return true;
}


// --- Test Suite ---

describe('Detached JWS Cryptography', () => {
  let keyPair: { privateKey: MldsaPrivateJwk; publicKey: MldsaPublicJwk & { kid: string } };
  const payload = {
    iss: 'did:example:123',
    sub: 'did:example:456',
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'EmployeeRoleCredential'],
      credentialSubject: {
        'org.schema.Person.email': 'employee@acme.com',
      },
    },
  };

  beforeAll(async () => {
    // Use the pre-generated, deterministic external client key pair for reproducible tests.
    keyPair = {
      privateKey: externalClientSignerJwk as MldsaPrivateJwk,
      publicKey: externalClientSignerJwk as MldsaPublicJwk & { kid: string; },
    };
  });

  it('should create a valid detached JWS signature', async () => {
    const detachedJws = await signDetached(payload, keyPair.privateKey);
    const parts = detachedJws.split('.');
    expect(parts.length).toBe(3);
    expect(parts[1]).toBe('');
    const header = decodeHeader(parts[0]);
    expect(header.alg).toEqual('ML-DSA-44');
    expect(header.kid).toEqual(keyPair.publicKey.kid);
  });

  it('should successfully verify a valid signature', async () => {
    const detachedJws = await signDetached(payload, keyPair.privateKey);
    await expect(verifyDetached(detachedJws, payload, keyPair.publicKey)).resolves.toBe(true);
  });

  it('should throw an error for an invalid signature', async () => {
    const detachedJws = await signDetached(payload, keyPair.privateKey);
    const invalidPayload = { ...payload, "newClaim": "someValue" };
    await expect(verifyDetached(detachedJws, invalidPayload, keyPair.publicKey))
      .rejects.toThrow('Invalid signature');
  });

  it('should throw an error if the public key does not match', async () => {
    const detachedJws = await signDetached(payload, keyPair.privateKey);
    
    // Create a new, different key pair to simulate a mismatch
    const seed2 = new Uint8Array(32).fill(1); // Different seed
    const { publicKey: otherPublicKeyBytes } = mlDsa.ml_dsa44.keygen(seed2);
    const other_pub_b64 = Content.bytesToRawBase64UrlSafe(otherPublicKeyBytes);
    
    // Create a new public key object. To ensure the test fails on the *signature* check
    // and not a simple header mismatch, we'll give it the same `alg` and `kid` as the
    // original key.
    const otherPublicKey: MldsaPublicJwk & { kid: string } = {
      kty: 'AKP',
      alg: 'ML-DSA-44', // Match alg to pass initial check
      pub: other_pub_b64,
      kid: keyPair.publicKey.kid // Match kid to pass initial check
    };

    await expect(verifyDetached(detachedJws, payload, otherPublicKey))
      .rejects.toThrow('Invalid signature');
  });
});