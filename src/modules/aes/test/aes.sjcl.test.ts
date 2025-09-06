// IMPORTANT! Install first 'react-native-randombytes' in react-native
import sjcl, { SjclCipherEncrypted } from 'sjclplus';
import { testAadBase64UrlNoPadding, testDataJSON, testMockRandom16BytesBase64UrlNoPadding } from './aes.test.data';
import { AESManager } from '../aes.manager';
import { DecryptionDataWithParametersSJCL, EncryptionParametersSJCL } from '../aes.model';
import { base64UrlToBase64 } from '../../didcomm';
// import { testHeadersNonCompressedJWE } from '../../../../test/data/jwe.data';

const aesManager = new AESManager();

// TODO: use the same data as in Golang tests
export const testSharedKeyB64UrlSafeCEK = 'Lo6-e-4oBOgi-aA5K830Qhc44Z3eaIScraodNv68oMc'; // 'DLbFlEIIShHBU_jvxDb97u0zwMhZiYJy-M2aymp8ut8';

/** NOTES:
 *  - sjcl processes the concatenation of both (ciphertext|tag) but it requres the IV (nonce) and AAD data too.
 *  - AES-GCM is an authenticated encryption algorithm. It automatically generates an authentication "tag" during encryption, which is used for authentication during decryption.
 *  - The AAD data (Additional Authenticated Data) in a compact JWE is ASCII(Encoded Protected Header).
 *  If a JWE AAD value is present (which can only be the case when using the JWE JSON Serialization),
 *  instead let the Additional Authenticated Data encryption parameter be ASCII(Encoded Protected Header || '.' || BASE64URL(JWE AAD))
 */
 
// sjcl.json={defaults:{v:1,iter:1E4,ks:128,ts:64,mode:"ccm",adata:"",cipher:"aes"},

describe("test SJCL", () => { 

    it("1-should encrypt and decrypt with AES CCM without DB overhead", async () => {
        const testDataStringified = JSON.stringify(testDataJSON);
        const nonceBase64Url = testMockRandom16BytesBase64UrlNoPadding; // testing base64Url because SJCL uses Standard Base64 encoding (with padding '=') instead of Raw Base64Url encoding (without padding)
        const aadEmptyString = "";
        const aadBase64Url = testAadBase64UrlNoPadding
        const testSymmetricKey = "myPassword";

        // Encrypt: sjcl expects BiiArray data for the encryption object but not Base64 encoded data.
        // - SjclCipherEncryptParams tells the "salt" is BitArray but it gives "unsupported type" error, so the right thing is a Base64 string (not Base64Url)
        // - SjclCipherEncryptParams tells the "adata" can be undefined but it gives "unsupported type" error, so the right thing is an empty string or Base64 string (not Base64Url).
        // - The SjclCipherEncrypted "adata" output is encoded in Base64 again, so 2 encodings / decodings are expected for decryption (i don't know the reason of encoding the output a second time).
        // - The SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON later.
        const encryptionParametersSJCL: EncryptionParametersSJCL = {
            iv: sjcl.codec.base64url.toBits(nonceBase64Url), // BitArray
            adata: sjcl.codec.base64url.toBits(aadBase64Url), // BitArray, the string can be empty ""
            // mode:"ccm", "gcm" (the default is "ccm").
            // ts: 64, // tagsize to know what size authentication tag is part of the cipher text, the default is 64 bits.
            // ks: 128, // keysize to know what size key to generate with Pbkdf2, the default is 128 bits.
            // iter: 10000,  // iterations for Pbkdf2, the default is 10000 (10k).
            // salt: sjcl.codec.base64url.toBits(nonceBase64Url), // BitArray, a 64 bits salt is created automatically if not provided.
            // v: 1, // scjl version
            // cipher: "aes",
        };

        // the SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON
        const encryptedResultSJCL = sjcl.encrypt(testSymmetricKey,testDataStringified, encryptionParametersSJCL as any);
        const encryptedResultObject = JSON.parse(encryptedResultSJCL as any);
        const encryptedDataAndTagBase64 = encryptedResultObject.ct // "ct": "I2F0z+eZLahG2wNO9CkDSGli2FsZtena/YscAA=="

        console.log("SJCL encryptedResult = ",encryptedResultSJCL); // <- it is not an object
        console.log("SJCL encryptedResultObject parsed = ", JSON.stringify(encryptedResultObject, undefined, 2));

        // Decrypt: sjcl expects base64 encoded strings for the decryption object
        const decryptionDataWithParameters: DecryptionDataWithParametersSJCL = {
            iv: base64UrlToBase64(nonceBase64Url), // Base64, but not Base64url nor BitArray (it gives unsuported format but SjclCipherEncryptParams tells that it shall be a BitArray...)
            adata: base64UrlToBase64(aadBase64Url), // Base64 or empty "" but not undefined nor BitArray
            ct: encryptedDataAndTagBase64
            // mode:"ccm", "gcm" (the default is "ccm").
            // ts: 64, // tagsize to know what size authentication tag is part of the cipher text, the default is 64 bits.
            // ks: 128, // keysize to know what size key to generate with Pbkdf2, the default is 128 bits.
        };
        // The decryption data cannot be a JSON object, it must be stringified for SJCL
        const decryptionDataSJCL: SjclCipherEncrypted = JSON.stringify(decryptionDataWithParameters) as any;
        const decryptedPlaintextData = sjcl.decrypt(testSymmetricKey,decryptionDataSJCL);

        expect(decryptedPlaintextData).toBe(testDataStringified)
        // console.log("decryptedPlaintextData result (stringified) = ", decryptedPlaintextData)
        //Result > { test: 'something' }
    });

    // from https://stackoverflow.com/questions/49735346/what-is-right-way-doing-aes-gcm-decription-with-sjcl-js
    it("2-should encrypt and decrypt with AES GCM and the generic sjcl.encrypt", async () => {
        // Creating the test data: the Initialization Vector "iv" is the nonce
        const plaintextData = JSON.stringify(testDataJSON);             // e.g.: JWE plaintext
        const cekBase64Url  = testSharedKeyB64UrlSafeCEK;               // the symmetric key for the data / content encryption (DEK or CEK)
        const nonceBase64Url= testMockRandom16BytesBase64UrlNoPadding;  // NIST 800.D allows the Initializatin Vector to be 16 bytes length instead of the default 12 bytes
        const aadBase64Url  = testAadBase64UrlNoPadding;                // e.g.: the protected header claims of a JWE

        // AES Encryption
        const encryptedDataAndTabBase64Url = await AESManager.encryptAESGCM(cekBase64Url, plaintextData, aadBase64Url, nonceBase64Url);
        // AES Decryption
        const decryptedPlaintextData = await AESManager.decryptAESGCM(cekBase64Url, encryptedDataAndTabBase64Url, aadBase64Url, nonceBase64Url);
        expect(decryptedPlaintextData).toBe(plaintextData)
        console.log("decryptedPlaintextData result (stringified) = ", decryptedPlaintextData)
    });

});