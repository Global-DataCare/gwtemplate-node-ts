// IMPORTANT! Install first 'react-native-randombytes' in react-native

/* Copyright (c) Conéctate Soluciones y Aplicaciones SL, Copyright (c) Connecting Solution & Applications Ltd. */
/* Apache License 2.0 */

import sjcl, { SjclCipherEncrypted } from 'sjclplus';
import { EncryptionParametersSJCL, DecryptionDataWithParametersSJCL,
    AES_GCM_256_KEY_SIZE_BITS, AES_GCM_TAG_SIZE_BITS,
    ProtectedDataAES,
} from './aes.model';
import { joinCiphertextAndTagBase64Url, splitCiphertextAndTagBitArraySJCL } from './sjcl.utils'
import { base64ToBase64Url, base64UrlToBase64 } from '../didcomm';

/** NOTES:
 *  - sjcl processes the concatenation of both (ciphertext|tag) but it requres the IV (nonce) and AAD data too.
 *  - AES-GCM is an authenticated encryption algorithm. It automatically generates an authentication "tag" during encryption, which is used for authentication during decryption.
 *  - The AAD data (Additional Authenticated Data) in a compact JWE is ASCII(Encoded Protected Header).
 *  If a JWE AAD value is present (which can only be the case when using the JWE JSON Serialization),
 *  instead let the Additional Authenticated Data encryption parameter be ASCII(Encoded Protected Header || '.' || BASE64URL(JWE AAD))
 */

export class AESManager {
    constructor(){}
    /** It returns the AES ciphertext Base64Url encoded which has the tag data concatenated at the end, so it will be separated for JWE.
     * pinPassword: entered by the user.
     * plaintextData: stringified data, e.g: a DB password.
     * ivBase64Url:  random bytes generated to encrypt and required to decrypt, usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
     * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
     */
    public static async encryptAESCCM (
        pinPassword:    string, // entered by the user.
        plaintextData:  string, // e.g. a DB password
        ivBase64Url:    string  // random bytes generated to encrypt and required to decrypt, usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    ): Promise<string> 
    {    
        return await encryptAESCCM(pinPassword,plaintextData,ivBase64Url)   
    }

    /** It returns the decrypted data (plaintext), for example, a DB password.
     * pinPassword: entered by the user.
     * encryptedDataAndTagBase64Url: encrypted data + tag (base64url encoded).
     * ivBase64Url: random bytes generated when encrypting
     * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
     */
    public static async decryptAESCCM (
        pinPassword: string,
        encryptedDataAndTagBase64Url: string, // in case of a JWE it has the payload + tag (base64url encoded).
        ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    ): Promise<string> 
    {
        return await decryptAESCCM(pinPassword,encryptedDataAndTagBase64Url,ivBase64Url)   
    }

    /** It returns the AES ciphertext Base64Url encoded which has the tag data concatenated at the end, so it will be separated for JWE.
     * cekBase64Url: symmetric key for the data AES encryption.
     * plaintextData: stringified payload in case of a JWT.
     * aadBase64Url: AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
     * ivBase64Url: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
     * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
     */
    public static async encryptAESGCM (
        cekBase64Url:   string, // symmetric key for the data AES encryption.
        plaintextData:  string, // stringified payload in case of a JWT.
        aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
        ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    ): Promise<string> 
    {  
        return await encryptAESGCM(cekBase64Url, plaintextData, aadBase64Url, ivBase64Url);
    }

    /** It receives the returns the decrypted plaintext, then it can be converted to JSON (e.g.: JWE payload)
     * cekBase64Url: symmetric key for the data AES encryption.
     * encryptedDataAndTagBase64Url: in case of a JWE it has the payload + tag (base64url encoded).
     * aadBase64Url: the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
     * ivBytesLength: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
     * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
     */
    public static async decryptAESGCM (
        cekBase64Url:   string, // symmetric key for the data AES encryption.
        encryptedDataAndTagBase64Url: string, // in case of a JWE it has the payload + tag (base64url encoded).
        aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
        ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    ): Promise<string> 
    {      
        return await decryptAESGCM(cekBase64Url, encryptedDataAndTagBase64Url, aadBase64Url, ivBase64Url);
    }

    /** It separates ciptertext/tag combination and return ProtectedDataAES (ct, tag, iv) which can be used as JWEData */
    public static async getProtectedDataForJWE(nonceBase64Url: string, ctAndTagBase64Url: string): Promise<ProtectedDataAES> {
        return await formatProtectedDataAES(nonceBase64Url, ctAndTagBase64Url);
    }

    /** 
     * cekBase64Url: symmetric key for the data AES encryption.
     * plaintextDataStringified: stringified payload in case of a JWT.
     * aadBase64Url: the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
     * ivBase64Url: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
     * tagBase64Url: tag generated by the AES encryption required to decrypt the data (sjcl expects ciphertext + tag)
     * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
     */
    public static async decryptProtectedDataJWE (
        cekBase64Url:   string, // symmetric key for the data AES decryption.
        ctBase64Url:    string, // JWE ciphertext, sjcl expects ciphertext + tag
        aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
        ivBase64Url:    string, // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
        tagBase64Url:   string  // tag generated by the AES encryption required to decrypt the data (sjcl expects ciphertext + tag)
    ): Promise<string> 
    {
        return await aesDecryptProtectedDataJWE(cekBase64Url,ctBase64Url,aadBase64Url,ivBase64Url,tagBase64Url)
    }
}

/** It returns the AES ciphertext Base64Url encoded which has the tag data concatenated at the end, so it will be separated for JWE.
 * pinPassword: entered by the user.
 * plaintextData: stringified data, e.g: a DB password.
 * ivBase64Url:  random bytes generated to encrypt and required to decrypt, usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function encryptAESCCM (
    pinPassword:    string, // entered by the user.
    plaintextData:  string, // e.g. a DB password
    ivBase64Url:    string  // random bytes generated to encrypt and required to decrypt, usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<string> 
{    
    // Encrypt (sjcl expects base64 encoded strings):
    // - SjclCipherEncryptParams tells the "salt" is BitArray but it gives "unsupported type" error, so the right thing is a Base64 string (not Base64Url)
    // - SjclCipherEncryptParams tells the "adata" can be undefined but it gives "unsupported type" error, so the right thing is an empty string or Base64 string (not Base64Url).
    // - The SjclCipherEncrypted "adata" output is encoded in Base64 again, so 2 encodings / decodings are expected for decryption (i don't know the reason of encoding the output a second time).
    // - The SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON later.
    const encryptionParametersSJCL: EncryptionParametersSJCL = { // in SjclCipherEncryptParams the salt is BitArray
        iv: sjcl.codec.base64url.toBits(ivBase64Url), // BitArray, it is created automatically if not provided.
        adata: sjcl.codec.base64url.toBits(""), // it is Base64 encoded (not Base64Url) with or without padding and ti can be empty "" 
        ks: 256,  // key size is 32 bytes = 256 bits (by default it is 128 bits).
    };
    const encryptedResultSJCL = sjcl.encrypt(pinPassword,plaintextData, encryptionParametersSJCL as any);
    const encryptedResultObject = JSON.parse(encryptedResultSJCL as any); // the SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON
    const ciphertextAndTagBase64 = encryptedResultObject.ct
    return base64ToBase64Url(ciphertextAndTagBase64)   
}

/** It returns the decrypted data (plaintext), for example, a DB password.
 * pinPassword: entered by the user.
 * encryptedDataAndTagBase64Url: encrypted data + tag (base64url encoded).
 * ivBase64Url: random bytes generated when encrypting
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function decryptAESCCM (
    pinPassword: string,
    encryptedDataAndTagBase64Url: string, // in case of a JWE it has the payload + tag (base64url encoded).
    ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<string> 
{  
    // Decrypt: sjcl expects base64 encoded strings for the decryption object
    const decryptionDataWithParameters: DecryptionDataWithParametersSJCL = {
        iv: base64UrlToBase64(ivBase64Url), // Base64, but not Base64url nor BitArray (it gives unsuported format but SjclCipherEncryptParams tells that it shall be a BitArray...)
        adata: base64UrlToBase64(""), // Base64 or empty "" but not undefined nor BitArray
        ct: base64UrlToBase64(encryptedDataAndTagBase64Url), // ciphertext and tag combined and then base64 encoded, but not base64url nor BitArray.
        ks: 256,  // key size is 32 bytes = 256 bits (by default it is 128 bits).
    };
    // The decryption data cannot be a JSON object, it must be stringified for SJCL
    const encryptedDataSJCL: SjclCipherEncrypted = JSON.stringify(decryptionDataWithParameters) as any;

    const decryptedPlaintextData = sjcl.decrypt(pinPassword,encryptedDataSJCL);
    return decryptedPlaintextData
}

/** It returns the AES ciphertext Base64Url encoded which has the tag data concatenated at the end, so it will be separated for JWE.
 * cekBase64Url: symmetric key for the data AES encryption.
 * plaintextDataStringified: stringified payload in case of a JWT.
 * aadBase64Url: the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
 * ivBytesLength: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function encryptAESGCM (
    cekBase64Url:   string, // symmetric key for the data AES encryption.
    plaintextData:  string, // stringified payload in case of a JWT.
    aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
    ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<string> 
{    
    // Encrypt (sjcl expects base64 encoded strings):
    // - SjclCipherEncryptParams tells the "salt" is BitArray but it gives "unsupported type" error, so the right thing is a Base64 string (not Base64Url)
    // - SjclCipherEncryptParams tells the "adata" can be undefined but it gives "unsupported type" error, so the right thing is an empty string or Base64 string (not Base64Url).
    // - The SjclCipherEncrypted "adata" output is encoded in Base64 again, so 2 encodings / decodings are expected for decryption (i don't know the reason of encoding the output a second time).
    // - The SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON later.
    const encryptionParametersSJCL: EncryptionParametersSJCL = { // in SjclCipherEncryptParams the salt is BitArray
        iv: sjcl.codec.base64url.toBits(ivBase64Url), // BitArray, it is created automatically if not provided.
        adata: sjcl.codec.base64url.toBits(aadBase64Url), // it is Base64 encoded (not Base64Url) with or without padding and ti can be empty "" 
        ks: AES_GCM_256_KEY_SIZE_BITS,  // key size is 32 bytes = 256 bits (by default it is 128 bits).
        ts: AES_GCM_TAG_SIZE_BITS,      // tag size is 16 bytes = 128 bits (by default it is 64 bits).
        mode: "gcm",
        // salt: AES GCM does not use salt (no key derivation is used in GCM but a symmetric key)
    };
    const cekBitArray = sjcl.codec.base64url.toBits(cekBase64Url)        
    const encryptedResultSJCL = sjcl.encrypt(cekBitArray,plaintextData, encryptionParametersSJCL as any);
    const encryptedResultObject = JSON.parse(encryptedResultSJCL as any); // the SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON
    const ciphertextAndTagBase64 = encryptedResultObject.ct
    return base64ToBase64Url(ciphertextAndTagBase64)   
}

async function formatProtectedDataAES(nonceBase64Url: string, ctAndTagBase64Url: string): Promise<ProtectedDataAES> {
    // Separate ciptertext/tag combination
    const [ctBase64Url, tagBase64Url] = splitCiphertextAndTagBitArraySJCL(ctAndTagBase64Url, AES_GCM_TAG_SIZE_BITS)
    
    // creating the JWE data
    const protectedData: ProtectedDataAES = {
        ciphertext: ctBase64Url,
        iv: nonceBase64Url,
        tag: tagBase64Url
    }
    return protectedData
}

/** It receives the returns the decrypted plaintext, then it can be converted to JSON (e.g.: JWE payload)
 * cekBase64Url: symmetric key for the data AES encryption.
 * encryptedDataAndTagBase64Url: in case of a JWE it has the payload + tag (base64url encoded).
 * aadBase64Url: the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
 * ivBytesLength: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function decryptAESGCM (
    cekBase64Url:   string, // symmetric key for the data AES encryption.
    encryptedDataAndTagBase64Url: string, // in case of a JWE it has the payload + tag (base64url encoded).
    aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
    ivBase64Url:    string  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<string> 
{  
    // Decrypt: sjcl expects base64 encoded strings for the decryption object
    const decryptionDataWithParameters: DecryptionDataWithParametersSJCL = {
        iv: base64UrlToBase64(ivBase64Url), // Base64, but not Base64url nor BitArray (it gives unsuported format but SjclCipherEncryptParams tells that it shall be a BitArray...)
        adata: base64UrlToBase64(aadBase64Url), // Base64 or empty "" but not undefined nor BitArray
        ct: base64UrlToBase64(encryptedDataAndTagBase64Url), // ciphertext and tag combined and then base64 encoded, but not base64url nor BitArray.
        ts: AES_GCM_TAG_SIZE_BITS,      // tag size is 16 bytes = 128 bits (by default it is 64 bits).
        ks: AES_GCM_256_KEY_SIZE_BITS,  // key size is 32 bytes = 256 bits (by default it is 128 bits).
        mode: "gcm"
    };
    // The decryption data cannot be a JSON object, it must be stringified for SJCL
    const encryptedDataSJCL: SjclCipherEncrypted = JSON.stringify(decryptionDataWithParameters) as any;

    const cekBitArray = sjcl.codec.base64url.toBits(cekBase64Url);
    const decryptedPlaintextData = sjcl.decrypt(cekBitArray,encryptedDataSJCL);
    return decryptedPlaintextData
}

/** 
 * - cekBase64Url: symmetric key for the data AES encryption.
 * - ctBase64Url: ciphertext
 * - aadBase64Url: AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
 * - ivBase64Url: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 * - tagBase64Url: tag generated by the AES encryption required to decrypt the data (sjcl expects ciphertext + tag)
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function aesDecryptProtectedDataJWE (
    cekBase64Url:   string, // symmetric key for the data AES decryption.
    ctBase64Url:    string, // JWE ciphertext, sjcl expects ciphertext + tag
    aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
    ivBase64Url:    string, // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    tagBase64Url:   string  // tag generated by the AES encryption required to decrypt the data (sjcl expects ciphertext + tag)
): Promise<string> 
{
    // console.log('decrypt AES with CEK = ', cekBase64Url);
    const result = await decryptAESGCM(cekBase64Url, joinCiphertextAndTagBase64Url(ctBase64Url, tagBase64Url), aadBase64Url, ivBase64Url)
    return result;
}
