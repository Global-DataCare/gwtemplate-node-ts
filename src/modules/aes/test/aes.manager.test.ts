// IMPORTANT! Install first 'react-native-randombytes' in react-native
import sjcl, { SjclCipherEncrypted } from 'sjclplus';
import { AESManager } from '../aes.manager';
import { DecryptionDataWithParametersSJCL, EncryptionParametersSJCL } from '../aes.model';
import { testDataJSON, testAadBase64UrlNoPadding, testMockRandom16BytesBase64UrlNoPadding, RandomAlice32BytesBase64Url} from "./aes.test.data";
import { base64UrlToBase64 } from '../../didcomm';

const aesManager = new AESManager();

// TODO: test decryptPlaintextDataJWE

/** NOTES:
 *  - sjcl processes the concatenation of both (ciphertext|tag) but it requres the IV (nonce) and AAD data too.
 *  - AES-GCM is an authenticated encryption algorithm. It automatically generates an authentication "tag" during encryption, which is used for authentication during decryption.
 *  - The AAD data (Additional Authenticated Data) in a compact JWE is ASCII(Encoded Protected Header).
 *  If a JWE AAD value is present (which can only be the case when using the JWE JSON Serialization),
 *  instead let the Additional Authenticated Data encryption parameter be ASCII(Encoded Protected Header || '.' || BASE64URL(JWE AAD))
 */
 
// sjcl.json={defaults:{v:1,iter:1E4,ks:128,ts:64,mode:"ccm",adata:"",cipher:"aes"},

describe("test AES CCM encryption with password", () => { 

    it("should SJCL encrypt and decrypt a CEK (wrap and unwrap) with AES CCM from a PIN", async () => {
        const testPIN = "1234"
        const ramdomCEKBase64Url = sjcl.codec.base64url.fromBits(sjcl.random.randomWords(8)) // 8 words * 32 bits = 256 bits / 32 bytes
        console.log(`new CEK generated (base64url encoded) is ${ramdomCEKBase64Url}`)

        const nonceBase64Url = testMockRandom16BytesBase64UrlNoPadding; // testing base64Url because SJCL uses Standard Base64 encoding (with padding '=') instead of Raw Base64Url encoding (without padding)
        const aadEmptyString = "";

        // Encrypt: sjcl expects BiiArray data for the encryption object but not Base64 encoded data.
        // - SjclCipherEncryptParams tells the "salt" is BitArray but it gives "unsupported type" error, so the right thing is a Base64 string (not Base64Url)
        // - SjclCipherEncryptParams tells the "adata" can be undefined but it gives "unsupported type" error, so the right thing is an empty string or Base64 string (not Base64Url).
        // - The SjclCipherEncrypted "adata" output is encoded in Base64 again, so 2 encodings / decodings are expected for decryption (i don't know the reason of encoding the output a second time).
        // - The SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON later.
        const encryptionParametersSJCL: EncryptionParametersSJCL = {
            iv: sjcl.codec.base64url.toBits(nonceBase64Url), // BitArray
            ks: 256, // keysize to know what size key to generate with Pbkdf2, the default is 128 bits.
            adata: sjcl.codec.base64url.toBits(aadEmptyString), // BitArray, the string can be empty ""
            // mode:"ccm" // the default is "ccm".
        };

        // the SjclCipherEncrypted output is not an object, it SHALL be parsed to JSON
        const encryptedResultSJCL = sjcl.encrypt(testPIN,ramdomCEKBase64Url, encryptionParametersSJCL as any);
        const encryptedResultObject = JSON.parse(encryptedResultSJCL as any);
        const encryptedDataAndTagBase64 = encryptedResultObject.ct // "ct": "I2F0z+eZLahG2wNO9CkDSGli2FsZtena/YscAA=="

        console.log("SJCL encryptedResult = ",encryptedResultSJCL); // <- it is not an object
        console.log("SJCL encryptedResultObject parsed = ", JSON.stringify(encryptedResultObject, undefined, 2));

        // Decrypt: sjcl expects base64 encoded strings for the decryption object
        const decryptionDataWithParameters: DecryptionDataWithParametersSJCL = {
            iv: base64UrlToBase64(nonceBase64Url), // Base64, but not Base64url nor BitArray (it gives unsuported format but SjclCipherEncryptParams tells that it shall be a BitArray...)
            ks: 256, // keysize to know what size key to generate with Pbkdf2, the default is 128 bits.
            adata: base64UrlToBase64(aadEmptyString), // Base64 or empty "" but not undefined nor BitArray
            ct: encryptedDataAndTagBase64
            // mode:"ccm", "gcm" (the default is "ccm").
            // ts: 64, // tagsize to know what size authentication tag is part of the cipher text, the default is 64 bits.
            // ks: 128, // keysize to know what size key to generate with Pbkdf2, the default is 128 bits.
        };
        // The decryption data cannot be a JSON object, it must be stringified for SJCL
        const decryptionDataSJCL: SjclCipherEncrypted = JSON.stringify(decryptionDataWithParameters) as any;
        const decryptedPlaintextData = sjcl.decrypt(testPIN,decryptionDataSJCL);

        expect(decryptedPlaintextData).toBe(ramdomCEKBase64Url)
        // console.log("decryptedPlaintextData result (stringified) = ", decryptedPlaintextData)
        //Result > { test: 'something' }
    });

    it("should work encryptAESCCM and decryptAESCCM (wrap and unwrap) from a PIN", async () => {
        const testPIN = "1234"
        const ramdomCEKBase64Url = sjcl.codec.base64url.fromBits(sjcl.random.randomWords(8)) // 8 words * 32 bits = 256 bits / 32 bytes
        console.log(`new CEK generated (base64url encoded) is ${ramdomCEKBase64Url}`)

        const nonceBase64Url = testMockRandom16BytesBase64UrlNoPadding; // testing base64Url because SJCL uses Standard Base64 encoding (with padding '=') instead of Raw Base64Url encoding (without padding)
        const aadEmptyString = "";

        // Encrypt: sjcl expects BiiArray data for the encryption object but not Base64 encoded data.
        const ciphertextAndTagBase64Url = await AESManager.encryptAESCCM(testPIN, ramdomCEKBase64Url, nonceBase64Url)

        // Decrypt: sjcl expects base64 encoded strings for the decryption object
        const decryptedData = await AESManager.decryptAESCCM(testPIN, ciphertextAndTagBase64Url, nonceBase64Url)

        expect(decryptedData).toBe(ramdomCEKBase64Url)
        // console.log("decryptedPlaintextData result (stringified) = ", decryptedPlaintextData)
        //Result > { test: 'something' }
        
        /* TODO
        const protectedData: ProtectedDataSJCL = {
            ct: ciphertextAndTagBase64Url,
            iv: nonceBase64Url
        }
        */
    });
})

describe("test AES GCM (no password)", () => { 

    // from https://stackoverflow.com/questions/49735346/what-is-right-way-doing-aes-gcm-decription-with-sjcl-js
    it("should work encryptAESGCM and decryptAESGCM", async () => {

        // Creating the test data: the AAD (Additional Authenticated Data) is the JWE protected header claims (Base64Url encoded)
        const plaintextDataStringified = JSON.stringify(testDataJSON);
        const cekBase64Url = RandomAlice32BytesBase64Url;
        const aadBase64Url = testAadBase64UrlNoPadding; // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
        // const aadVerificationBase64 = stringToStdBase64(base64UrlToBase64(aadBase64Url)); // base64url to base64 and then encoded a second time to base64 as the sjcl output do.
        // const aadVerificationBitArray = sjcl.codec.base64.toBits(aadVerificationBase64);    
        const nonceBase64Url = testMockRandom16BytesBase64UrlNoPadding; // testing base64Url because SJCL uses Standard Base64 encoding (with padding '=') instead of Raw Base64Url encoding (without padding)

        // Encrypt
        const ciphertextAndTag = await AESManager.encryptAESGCM(
            cekBase64Url,
            plaintextDataStringified,
            // NOTE: double Base64Url encoding: BASE64URL(JWE AAD) = BASE64URL( ASCII(BASE64URL(UTF8(JWE Protected Header))) )
            aadBase64Url,   // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
            nonceBase64Url  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
        );
        
        // Decrypt
        const decryptedPlaintextData = await AESManager.decryptAESGCM(
            cekBase64Url,
            ciphertextAndTag,
            aadBase64Url,       // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
            nonceBase64Url,     // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
        );

        // Result
        expect(decryptedPlaintextData).toBe(plaintextDataStringified);
    });

    it("should separate ciphertext and tag for JWE", async () => {

        // Creating the test data: the AAD (Additional Authenticated Data) is the JWE protected header claims (Base64Url encoded)
        const plaintextDataStringified = JSON.stringify(testDataJSON);
        const cekBase64Url = RandomAlice32BytesBase64Url;
        const aadBase64Url = testAadBase64UrlNoPadding; // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
        // const aadVerificationBase64 = stringToStdBase64(base64UrlToBase64(aadBase64Url)); // base64url to base64 and then encoded a second time to base64 as the sjcl output do.
        // const aadVerificationBitArray = sjcl.codec.base64.toBits(aadVerificationBase64);    
        const nonceBase64Url = testMockRandom16BytesBase64UrlNoPadding; // testing base64Url because SJCL uses Standard Base64 encoding (with padding '=') instead of Raw Base64Url encoding (without padding)

        // Encrypt
        const ciphertextAndTag = await AESManager.encryptAESGCM(
            cekBase64Url,
            plaintextDataStringified,
            aadBase64Url,   // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
            nonceBase64Url  // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
        );

        // getting JWE compatible ProtectedDataAES and decrypting the ciphertext
        const protectedDataAsJWE = await AESManager.getProtectedDataForJWE(nonceBase64Url, ciphertextAndTag);
        const decryptedPlaintextData = await AESManager.decryptProtectedDataJWE(
            cekBase64Url,
            protectedDataAsJWE.ciphertext,
            aadBase64Url,   // AAD is BASE64URL(ASCII(BASE64URL(UTF8(JWE Protected Header)) for compact JWE (single-recipient) or other BASE64URL(JWE AAD) data, such as the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants) for JSON (multi-recipient) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
            protectedDataAsJWE.iv,
            protectedDataAsJWE.tag // tagBase64Url:
        )

        // Result
        expect(decryptedPlaintextData).toBe(plaintextDataStringified);
    });
});