import { encode as encodeUTF8 } from "@stablelib/utf8";
import sjcl, { BitArray, SjclCipherEncryptParams } from "sjclplus";
import { Convert } from '../../../../src/modules/didcomm/convert';

export const RandomAlice32BytesBase64Url='MDEyMzQ1Njc4OT0_PT89PzAxMjM0NTY3ODk9Pz0_PT8';
export const RandomBob32BytesBase64Url  ='TvuJxmBx7TkhFZ7maMdcIQx-PDpDJwofFFdQsdyci0M';
export const testMocked12RandomBytesASCII = '012345=?=?=?'
export const testMocked16RandomBytesASCII = '0123456789=?=?=?'
export const testMocked24RandomBytesASCII = testMocked12RandomBytesASCII + testMocked12RandomBytesASCII
export const testMocked32RandomBytesASCII = testMocked16RandomBytesASCII + testMocked16RandomBytesASCII
export const testMockRandom12Bytes:Uint8Array = encodeUTF8(testMocked12RandomBytesASCII); // 12 ASCII to 12 bytes
export const testMockRandom16Bytes:Uint8Array = encodeUTF8(testMocked16RandomBytesASCII); // 16 ASCII to 16 bytes
export const testMockRandom24Bytes:Uint8Array = encodeUTF8(testMocked24RandomBytesASCII); // 24 ASCII to 24 bytes
export const testMockRandom32Bytes:Uint8Array = encodeUTF8(testMocked32RandomBytesASCII); // 32 ASCII to 32 bytes

export const testMockRandom16BytesBase64UrlNoPadding="MDEyMzQ1Njc4OT0_PT89Pw"

// 'aad': AEAD authenticated data is base64url(sha256(concat('.',sort([recipients[0].kid, ..., recipients[n].kid])))))
export const testAadStringifiedData = "** Hello world! That's all folks?? **";
export const testAadBase64UrlNoPadding = 'KiogSGVsbG8gd29ybGQhIFRoYXQncyBhbGwgZm9sa3M_PyAqKg'; // "** Hello world! That's all folks?? **"

export const testInitVectorSize12 = 12;
export const testInitVectorSize16 = 16;

export const testDataJSON = {test: 'something'};

/*
  var key = 'password';
  var p = { mode: 'gcm', iv: sjcl.random.randomWords(4, 0) };
  var encrypted = sjcl.encrypt(key, 'Hello World', p);

This leads to output e.g.:
{"iv":"/Jyo0DNWt0CNUW6AYkpnBw==","v":1,"iter":10000,"ks":128,"ts":64,"mode":"gcm","adata":"","cipher":"aes","salt":"jFSuZEEICq8=","ct":"7+M0Wv79zKXu4SUYJPZAIIBYgw=="}
*/

// sjcl.json={defaults:{v:1,iter:1E4,ks:128,ts:64,mode:"ccm",adata:"",cipher:"aes"},
/* OUTPUT
{
"iv":"tjp81jkAzUpW1bI9gLDDpg==", // iv Base64 encoded
"v":1,                           // version
"iter":1000,                     // iteration count
"ks":128,                        // key size in bits
"ts":64,                         // authentication strength
"mode":"ccm",                    // mode
"adata":"xxx",                   // authenticated data
"cipher":"aes",                  // cipher
"salt":"lx06UoJDNys=",           // key derivation salt
"ct":"Gv7ptKdTtUz6AGtX"          // ciphet text
}
*/

// creating the SjclCipherEncryptParams
export const testEncryptParamsSjcl16IV: SjclCipherEncryptParams = {
    ts: 256,
    mode: 'gcm',
    iv: createMockedRandomBitArray(testInitVectorSize16),
    salt: sjcl.codec.utf8String.toBits("") // undefined
};

// creating the SjclCipherEncryptParams
export const testEncryptParamsNoSalt16IV: any = { // EncryptParamsAES = {
    ts: 256,
    mode: 'gcm',
    iv: createMockedRandomBitArray(testInitVectorSize16),
    // salt: sjcl.codec.utf8String.toBits("") // undefined
};

// creating the SjclCipherEncryptParams
export const testEncryptParamsNoSalt12IV: any = { // EncryptParamsAES = {
    ts: 256,
    mode: 'gcm',
    iv: createMockedRandomBitArray(testInitVectorSize12),
    // salt: sjcl.codec.utf8String.toBits("") // undefined
};

function createMockedRandomBitArray(bytesLength?: number): BitArray {
    const mockedRandomBytesBase64Url = createMockedRandomBytesBase64Url(bytesLength);
    const mockedRamdomBitArray = sjcl.codec.base64url.toBits(mockedRandomBytesBase64Url);
    // console.log(`mockedRamdomBitArray length is ${mockedRamdomBitArray.length}`);
    return mockedRamdomBitArray;
}

function createMockedRandomBytesBase64Url(bytesLength?: number): string {
    switch (bytesLength) {
        case (12): {
            return Convert.bytesToRawBase64UrlSafe(testMockRandom12Bytes); // 012345=?=?=? is MDEyMzQ1PT89Pz0_
        }
        case (16): {
            return Convert.bytesToRawBase64UrlSafe(testMockRandom16Bytes); // 0123456789=?=?=? is MDEyMzQ1Njc4OT0_PT89Pw==
        }
        case (24): {
            return Convert.bytesToRawBase64UrlSafe(testMockRandom24Bytes); // 012345=?=?=?012345=?=?=? is MDEyMzQ1PT89Pz0_MDEyMzQ1PT89Pz0_
        }
        case (32): {
            return Convert.bytesToRawBase64UrlSafe(testMockRandom32Bytes); // 0123456789=?=?=?0123456789=?=?=? is MDEyMzQ1Njc4OT0_PT89PzAxMjM0NTY3ODk9Pz0_PT8=
        }
        default: console.warn("unsupported mocked size")
    }
    return ""
}