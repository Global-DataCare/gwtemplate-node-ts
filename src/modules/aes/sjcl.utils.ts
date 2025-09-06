import sjcl from "sjclplus";
import { WORD_BYTES } from "./aes.model";

/** Splits and returns base64url-encoded the ciptertext/tag combination from SJCL by using the tag bits size (CAUTION!: NOT BYTES) */
export function splitCiphertextAndTagBitArraySJCL(ctAndTagBase64Url: string, aesTagSizeBits: number): [string, string] {
    const WORD_BITS = 32;   // sjcl BitArray uses words of 32 bits.

    const tagSizeWords = aesTagSizeBits/WORD_BITS
    // console.log(`input AES tag size in bits = ${aesTagSizeBits}, size in words = ${tagSizeWords}, size in bytes = ${tagSizeWords*WORD_BYTES}`);

    const ctAndTagBitArray = sjcl.codec.base64url.toBits(ctAndTagBase64Url); // to BitsArray (words of 4 bytes or 32 bits)
    // console.log(`input ciphertext and tag size in words of 32 bits = ${ctAndTagBitArray.length}, size in bytes = ${ctAndTagBitArray.length*WORD_BYTES}`);

    const ctSizeWords = ctAndTagBitArray.length - tagSizeWords;
    // console.log(`ciphertext size in words of 32 bits = ${ctSizeWords}, size in bytes = ${ctSizeWords*WORD_BYTES}`);
    
    const ctBitArray = sjcl.bitArray.bitSlice(ctAndTagBitArray, 0, ctSizeWords*WORD_BITS);
    // console.log(`splitted ciphertext size in words of 32 bits = ${ctBitArray.length}, size in bytes = ${ctBitArray.length*WORD_BYTES}`);
    
    const tagBitArray = sjcl.bitArray.bitSlice(ctAndTagBitArray, ctSizeWords*WORD_BITS, (ctSizeWords+tagSizeWords)*WORD_BITS)
    // console.log(`splitted tag size in words of 32 bits = ${tagBitArray.length}, size in bytes = ${tagBitArray.length*WORD_BYTES}`);

    return [sjcl.codec.base64url.fromBits(ctBitArray), sjcl.codec.base64url.fromBits(tagBitArray)]
}

/** Returns ciphertext and tag joined and encoded in base64url to be used for SJCL decryption */
export function joinCiphertextAndTagBase64Url(ctBase64Url: string, tagBase64Url: string): string {
    // ciptertext/tag combination
    const ctBitArray = sjcl.codec.base64url.toBits(ctBase64Url);
    // console.log(`input ciphertext size in words of 32 bits = ${ctBitArray.length}, size in bytes = ${ctBitArray.length*WORD_BYTES}`);

    const tagBitArray = sjcl.codec.base64url.toBits(tagBase64Url);
    // console.log(`input tag size in words of 32 bits = ${tagBitArray.length}, size in bytes = ${tagBitArray.length*WORD_BYTES}`);

    const ctAndTagBitArray = sjcl.bitArray.concat(ctBitArray, tagBitArray);
    // console.log(`joined ciphertext and tag size (words) = ${ctAndTagBitArray.length}`);

    const resut = sjcl.codec.base64url.fromBits(ctAndTagBitArray);
    // console.log(`ciphertext and tag size in words of 32 bits = ${ctAndTagBitArray.length}, size in bytes = ${ctAndTagBitArray.length*WORD_BYTES}`);
    return resut;
}