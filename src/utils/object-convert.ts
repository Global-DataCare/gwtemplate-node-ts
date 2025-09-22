// src/utils/object-convert.ts

import { decodeURLSafe } from "@stablelib/base64";
import { bytesToStringUTF8, stringToBytesUTF8 } from './string-convert';
import { bytesToRawBase64UrlSafe } from './base-convert';

/** Compares two arrays and returns true if they are the same, false otherwise. */
export function arrayCompare(a: any[], b: any[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/** Merges two Uint8Arrays into a single Uint8Array. */
export function arrayMerge(a: Uint8Array, b: Uint8Array): Uint8Array {
    const mergedArray = new Uint8Array(a.length + b.length);
    mergedArray.set(a);
    mergedArray.set(b, a.length);
    return mergedArray;
}

/**
 * Serializes a JavaScript object to a Uint8Array of UTF-8 bytes.
 * NOTE: This does not perform canonicalization (sorting keys).
 */
export function objectToBytes(data: object): Uint8Array {
    return stringToBytesUTF8(JSON.stringify(data));
};

/**
 * Serializes a JavaScript object to a raw Base64URL string.
 * NOTE: This does not perform canonicalization (sorting keys).
 */
export function objectToRawBase64UrlSafe(data: object): string {
    const dataBytes = objectToBytes(data);
    return bytesToRawBase64UrlSafe(dataBytes);
}

/**
 * Deserializes a Base64URL string back into a JavaScript object.
 * @param base64UrlSafe The Base64URL encoded JSON string.
 * @returns A JavaScript object.
 */
export function base64UrlSafeToJSON(base64UrlSafe: string | undefined): object {
    if (!base64UrlSafe) {
        throw new Error("Input string is undefined.");
    }
    const dataBytes: Uint8Array = decodeURLSafe(base64UrlSafe);
    return JSON.parse(bytesToStringUTF8(dataBytes));
}
