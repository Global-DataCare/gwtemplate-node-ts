
// src/models/aes.ts

export const WORD_BYTES=4;
export const WORD_BITS=WORD_BYTES*8;        // sjcl BitArray are words of 32 bits.
export const AES_GCM_256_KEY_SIZE_BITS=256; // key size is 32 bytes = 256 bits (by default it is 128 bits).
export const AES_GCM_TAG_SIZE_BITS=128;     // tag size is 16 bytes = 128 bits (by default it is 64 bits).
export const AES_GCM_NONCE_SIZE_BITS=128;   // NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits). 
export const AES_GCM_JWA_ENC='A256GCM'      // AES GCM using 256-bit key, see https://datatracker.ietf.org/doc/html/rfc7518#section-5.1

/** ProtectedDataAES has separated the ciphertext and tag (they will be concatenated for decryption)
 *  - ciphertext: base64url encoded bytes of the plaintext
 *  - tag: base64url encoded
 *  - iv: base64url encoded (it is like a nonce)
*/
export interface ProtectedDataAES {
    ciphertext: string;
    tag: string;
    iv: string;
}

/** Use it instead of the SjclCipherDecryptParams to avoid problems with encryption / decryption
 * iv: required random bytes created for Initialization Vector (nonce) created when doing the encryption, base64 encoded (but not Base64url nor BitArray).
 * adata: AAD (Additional Authenticated Data) base64 encoded (e.g.: JWE protected headers), but not base64url nor BitArray. It can be and empty string "".
 * ct: ciphertext and tag combined and then base64 encoded, but not base64url nor BitArray.
 * ts: tagsize is only required if a value other than the sjcl default value (64 bits) is defined in the encryption options (to know what size authentication tag is part of the cipher text)
 * mode: "ccm", "gcm" (the default is "ccm").
 * ks: keysize is only required if a value other than the sjcl default value (128 bits) is defined in the encryption options (to know what size key to generate with Pbkdf2)
 * iter: iterations for Pbkdf2
 * v: scjl version
 * cipher: "aes"
 */
export interface DecryptionDataWithParametersSJCL {
    iv:     string; // required random bytes for Initialization Vector (nonce) base64 encoded, but not Base64url nor BitArray.
    adata:  string; // required AAD (Additional Authenticated Data) base64 encoded (e.g.: JWE protected headers), but not base64url nor BitArray. It can be and empty string "".
    ct:     string; // ciphertext and tag combined and then base64 encoded, but not base64url nor BitArray.
    ts?:    number; // tagsize is only required if a value other than the sjcl default value (64 bits) is defined in the encryption options (to know what size authentication tag is part of the cipher text)
    mode?:  string; // "ccm", "gcm" (the default is "ccm").
    ks?:    number; // keysize is only required if a value other than the sjcl default value (128 bits) is defined in the encryption options (to know what size key to generate with Pbkdf2)
    iter?:  number; // iterations for Pbkdf2
    v?:     number; // scjl version (optional, 1 is the default)
    cipher?:string; // "aes"
};

/** Use it instead of the SjclCipherEncryptParams to avoid problems with encryption / decryption
 * iv: required BitArray containing the random bytes for the Initialization Vector (nonce).
 * adata: required BitArray containing the AAD (Additional Authenticated Data), e.g.: JWE protected headers.
 * ts: tagsize is only required if a value other than the sjcl default value (64 bits) is used (to know what size authentication tag is part of the cipher text).
 * mode: "ccm", "gcm" (the default is "ccm").
 * ks: keysize is only required if a value other than the sjcl default value (128 bits) is used (to know what size key to generate with Pbkdf2)
 * iter: iterations for Pbkdf2
 * salt: BitArray, a 64 bits salt it is created automatically if not provided when generating the key from a password (KDF).
 * v: scjl version
 * cipher: "aes"
 */
 export interface EncryptionParametersSJCL {
    iv:     any;  // required sjcl.BitArray containing the random bytes for the Initialization Vector (nonce).
    adata:  any;  // required sjcl.BitArray containing the AAD (Additional Authenticated Data), e.g.: JWE protected headers.
    ts?:    number;         // tagsize is only required if a value other than the sjcl default value (64 bits) is used (to know what size authentication tag is part of the cipher text).
    mode?:   string;        // "ccm", "gcm" (the default is "ccm").
    ks?:    number;         // keysize is only required if a value other than the sjcl default value (128 bits) is used (to know what size key to generate with Pbkdf2)
    iter?:  number;         // iterations for Pbkdf2
    salt?:  any;  // sjcl.BitArray, a 64 bits salt it is created automatically if not provided when generating the key from a password (KDF).
    v?:     number;         // scjl version (optional, 1 is the default)
    cipher?: string;        // "aes"
};