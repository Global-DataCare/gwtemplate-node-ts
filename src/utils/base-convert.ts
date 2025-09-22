// src/utils/base-convert.ts

import {
    encode as encodeBase64,
    decode as decodeBase64,
    decodeURLSafe,
    encodeURLSafe,
} from "@stablelib/base64";
import { alphabetBase58, decodeN, encodeN } from './baseN';
import { stringToBytesUTF8 } from './string-convert';

/** Converts a Uint8Array to a hexadecimal string. */
export function bytesToHexString(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => {
        return ('0' + (byte & 0xff).toString(16)).slice(-2);
    }).join('');
};

/** Encodes a Uint8Array into a Base58 string. */
export function bytesToBase58(bytes: Uint8Array): string {
    return encodeN(bytes, alphabetBase58, undefined);
}

/** Decodes a Base58 string into a Uint8Array. */
export function base58ToBytes(base58str: string): Uint8Array {
    return decodeN(base58str, alphabetBase58);
}

/** Encodes a string into a standard Base64 string (with padding). */
export function stringToStdBase64(str: string): string {
    const dataBytes: Uint8Array = stringToBytesUTF8(str);
    return encodeBase64(dataBytes);
}

/** Converts a standard Base64 string to a Base64URL string. */
export function base64ToBase64Url(encodedData: string): string {
    if (encodedData && (encodedData.indexOf("+") !== -1 || encodedData.indexOf("/") !== -1)) {
        return encodedData.split("+").join("-").split("/").join("_");
    } else {
        return encodedData;
    }
}

/** Encodes a string into a Base64URL string. */
export function stringToBase64Url(stringifiedData: string): string {
    const encodedData = stringToStdBase64(stringifiedData);
    return base64ToBase64Url(encodedData);
}

/** Converts a Base64URL string to a standard Base64 string. */
export function base64UrlToBase64(encodedData: string): string {
    if (encodedData && (encodedData.indexOf("-") !== -1 || encodedData.indexOf("_") !== -1)) {
        return encodedData.split("-").join("+").split("_").join("/");
    } else {
        return encodedData;
    }
}

/** Decodes a string that is either Base64 or Base64URL into a Uint8Array. */
export function base64OrUrlSafeToBytes(base64OrUrlSafe: string): Uint8Array {
    if (String(base64OrUrlSafe).includes("+") || String(base64OrUrlSafe).includes("/")) {
        return  new Uint8Array(decodeBase64(base64OrUrlSafe));
    } else {
        return new Uint8Array(decodeURLSafe(base64OrUrlSafe));
    }
}

/** Encodes a Uint8Array into a standard Base64 string (with padding). */
export function bytesToBase64(bytes: Uint8Array): string {
    return encodeBase64(bytes);
}

/** Encodes a Uint8Array into a raw Base64URL string (no padding). */
export function bytesToRawBase64UrlSafe(bytes: Uint8Array): string {
    return encodeURLSafe(bytes).replace(/=/g, "");
}
