// src/utils/string-utils.ts

/**
 * Capitalizes the first letter of a string.
 * @param s The input string.
 * @returns The capitalized string.
 */
export function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A simple string sanitizer that removes characters that are not alphanumeric or common punctuation.
 * @param str The string to sanitize.
 * @returns The sanitized string.
 */
export function sanitizeString(str: string): string {
    str = str.replace(/[^a-z0-9áéíóúñü \.,_-]/gim, "");
    return str.trim();
}

/**
 * Converts a string to a string of its ASCII character codes.
 * @param text The input string.
 * @returns A string of character codes.
 */
/* tslint:disable:forin */
export function stringToASCII(text: any): string {
    let ascii = "";
    for (const f in text) {
        ascii = ascii + text.charCodeAt(f);
    }
    return ascii;
}

/**
 * Converts a string to an array of numbers representing its byte values.
 * From google closure library: https://github.com/google/closure-library/blob/8598d87242af59aac233270742c8984e2b2bdbe0/closure/goog/crypt/crypt.js#L117-L143
 * @param str The input string.
 * @returns An array of numbers.
 */
export function stringToBytesArrayOfNumbers(str: string): number[] {
    let out = [],
        p = 0;
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 128) {
            out[p++] = c;
        } else if (c < 2048) {
            out[p++] = (c >> 6) | 192;
            out[p++] = (c & 63) | 128;
        } else if (
            (c & 0xfc00) == 0xd800 &&
            i + 1 < str.length &&
            (str.charCodeAt(i + 1) & 0xfc00) == 0xdc00
        ) {
            // Surrogate Pair
            c = 0x10000 + ((c & 0x03ff) << 10) + (str.charCodeAt(++i) & 0x03ff);
            out[p++] = (c >> 18) | 240;
            out[p++] = ((c >> 12) & 63) | 128;
            out[p++] = ((c >> 6) & 63) | 128;
            out[p++] = (c & 63) | 128;
        } else {
            out[p++] = (c >> 12) | 224;
            out[p++] = ((c >> 6) & 63) | 128;
            out[p++] = (c & 63) | 128;
        }
    }
    return out;
}
