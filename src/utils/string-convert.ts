// src/utils/string-convert.ts

import { encode as encodeUTF8, decode as decodeUTF8 } from "@stablelib/utf8";

/**
 * Encodes a standard JavaScript string into a Uint8Array of strictly-validated UTF-8 bytes.
 * This is the standard and safest method for serializing text data.
 * @param str The string to convert.
 * @returns A Uint8Array.
 */
export function stringToBytesUTF8(str: string): Uint8Array {
    return encodeUTF8(str);
}

/**
 * Decodes a Uint8Array of strictly-validated UTF-8 bytes back into a string.
 * This will fail if the byte array does not represent valid UTF-8.
 * Use this for standard text and JSON.
 * @param array The UTF-8 byte array to convert.
 * @returns A string.
 */
export function bytesToStringUTF8(array: Uint8Array): string {
    return decodeUTF8(array);
}

/**
 * Decodes a Uint8Array containing binary data into a string by processing
 * each byte individually. This is more permissive than `bytesToStringUTF8` and is
 * specifically required for handling payloads from libraries (e.g., pako) that
 * may not be strictly UTF-8. Use this for decoding JWT payloads.
 * @param array The binary/ASCII byte array to convert.
 * @returns A string.
 */
export function bytesToStringASCII(array: Uint8Array): string {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while (i < len) {
        c = array[i++];
        switch (
        c >> 4
        ) {
            case 0:
            case 1:
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7:
                out += String.fromCharCode(c);
                break;
            case 12:
            case 13:
                char2 = array[i++];
                out += String.fromCharCode(((c & 0x1f) << 6) | (char2 & 0x3f));
                break;
            case 14:
                char2 = array[i++];
                char3 = array[i++];
                out += String.fromCharCode(
                    ((c & 0x0f) << 12) | ((char2 & 0x3f) << 6) | ((char3 & 0x3f) << 0)
                );
                break;
        }
    }
    return out;
}
