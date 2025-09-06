// IMPORTANT! Install first 'react-native-randombytes' in react-native
import { testAadBase64UrlNoPadding, testDataJSON, testMockRandom16BytesBase64UrlNoPadding } from './aes.test.data';
import { joinCiphertextAndTagBase64Url, splitCiphertextAndTagBitArraySJCL } from '../sjcl.utils';
import { AES_GCM_TAG_SIZE_BITS } from '../aes.model';
import { AESManager } from '../aes.manager';

const testSharedKeyB64UrlSafeCEK = 'Lo6-e-4oBOgi-aA5K830Qhc44Z3eaIScraodNv68oMc'; // 'DLbFlEIIShHBU_jvxDb97u0zwMhZiYJy-M2aymp8ut8';

const aesManager = new AESManager();

/** NOTES:
 *  - sjcl processes the concatenation of both (ciphertext|tag) but it requres the IV (nonce) and AAD data too.
 *  - AES-GCM is an authenticated encryption algorithm. It automatically generates an authentication "tag" during encryption, which is used for authentication during decryption.
 *  - The AAD data (Additional Authenticated Data) in a compact JWE is ASCII(Encoded Protected Header).
 *  If a JWE AAD value is present (which can only be the case when using the JWE JSON Serialization),
 *  instead let the Additional Authenticated Data encryption parameter be ASCII(Encoded Protected Header || '.' || BASE64URL(JWE AAD))
 */
 
// sjcl.json={defaults:{v:1,iter:1E4,ks:128,ts:64,mode:"ccm",adata:"",cipher:"aes"},

describe("test SJCL utils for AES GCM", () => { 

    it("should split and join ciphertext and tag for SJCL AES GCM encryption / decryption", async () => {

        // Creating the test data: the "iv" is the nonce and the "salt" should be the same as "iv" for JWE.
        const plaintextData = JSON.stringify(testDataJSON);             // e.g.: JWE plaintext
        const cekBase64Url  = testSharedKeyB64UrlSafeCEK;             // the symmetric key for the data / content encryption (DEK or CEK)
        const aadBase64Url  = testAadBase64UrlNoPadding;                // e.g.: the protected header claims of a JWE
        const nonceBase64Url= testMockRandom16BytesBase64UrlNoPadding;  // NIST 800.D allows the Initializatin Vector to be 16 bytes length instead of the default 12 bytes

        // Encrypt
        const ctAndTagBase64Url = await AESManager.encryptAESGCM(cekBase64Url, plaintextData, aadBase64Url, nonceBase64Url);
        // console.log(`SJCL ciphertext and tag base64url = ${ctAndTagBase64Url}`)

        // Separate SJCL ciptertext/tag combination for JSON Web Encryption
        const [ctBase64Url, tagBase64Url] = splitCiphertextAndTagBitArraySJCL(ctAndTagBase64Url, AES_GCM_TAG_SIZE_BITS)
        // console.log(`splitted ciphertext base64url = ${ctBase64Url}`)
        // console.log(`splitted tag base64url = ${tagBase64Url}`)

        // Joining the data for SJCL
        const result = joinCiphertextAndTagBase64Url(ctBase64Url, tagBase64Url)
        // console.log(`resulting SJCL ciphertext and tag base64url = ${result}`)
        expect(result).toBe(ctAndTagBase64Url)
    });

});
