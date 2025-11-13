// src/utils/vc-signer.ts

import { IKmsService } from '../crypto/interfaces/IKmsService';
import { canonicalize } from './json-canon';
import { createHash } from 'crypto';

/**
 * Creates the JWS detached payload by canonicalizing, hashing, and Base64Url-encoding the input object,
 * following a simplified Linked Data Proofs process.
 *
 * @param unsignedVc The VC object without the 'proof' property.
 * @returns The Base64Url-encoded SHA-256 hash, ready to be signed.
 */
function createLdpJwsPayload(unsignedVc: any): Uint8Array {
  // 1. Canonicalize the document to get a stable string representation.
  const canonicalVc = canonicalize(unsignedVc);

  // 2. Hash the canonical string with SHA-256.
  const hash = createHash('sha256').update(canonicalVc).digest();
  
  // The payload of the JWS is the hash of the canonicalized data.
  return hash;
}


/**
 * Signs a Verifiable Credential payload according to the JsonWebSignature2020 suite.
 * It canonicalizes the VC, hashes it, signs the hash, and then attaches the `proof`.
 * 
 * @param vcPayload The full, unsigned VC object.
 * @param verificationMethodId The full DID#key-id of the signing key.
 * @param kmsService The KMS service to perform the signing.
 * @param signerVaultId The vault ID of the signer (e.g., 'host').
 * @returns The signed Verifiable Credential with the `proof` section.
 */
export async function signVerifiableCredential(
  vcPayload: any,
  verificationMethodId: string,
  kmsService: IKmsService,
  signerVaultId: string
): Promise<any> {
  
  // 1. Normalize: Create a copy of the VC without the 'proof' property for signing.
  const { proof, ...unsignedVc } = vcPayload;

  // 2. Create the JWS payload by canonicalizing and hashing the normalized VC.
  const payloadToSign = createLdpJwsPayload(unsignedVc);

  // 3. Sign the HASH using the KMS.
  const jws = await kmsService.signWithManagedKey(payloadToSign, signerVaultId);
  const { protected: protectedHeader, signature } = jws.signatures[0];

  // 4. Construct the final 'proofValue' for the detached JWS.
  // It's `header..signature` because the payload is detached (the VC itself).
  const proofValue = `${protectedHeader}..${signature}`;

  // 5. Attach the proof to the original VC payload.
  return {
    ...vcPayload,
    proof: {
      type: 'JsonWebSignature2020',
      created: new Date().toISOString(),
      verificationMethod: verificationMethodId,
      proofPurpose: 'assertionMethod',
      proofValue: proofValue,
    },
  };
}
