// src/utils/convert.ts

import * as baseConvert from './base-convert';
import * as objectConvert from './object-convert';
import * as stringConvert from './string-convert';
import * as stringUtils from './string-utils';

/**
 * A unified facade class for all data conversion and utility functions.
 * This class encapsulates functionality from the various utility modules
 * (base-convert, object-convert, etc.) into a single, consistent interface.
 */
export class Content {
    // --- String Conversions (from string-convert.ts) ---
    /** Encodes a string into a Uint8Array of strictly-validated UTF-8 bytes. */
    static stringToBytesUTF8 = stringConvert.stringToBytesUTF8;
    /** Decodes a Uint8Array of strictly-validated UTF-8 bytes back into a string. */
    static bytesToStringUTF8 = stringConvert.bytesToStringUTF8;
    /** Decodes a Uint8Array containing binary/ASCII data into a string. */
    static bytesToStringASCII = stringConvert.bytesToStringASCII;

    // --- String Utilities (from string-utils.ts) ---
    /** Capitalizes the first letter of a string. */
    static capitalize = stringUtils.capitalize;
    /** A simple string sanitizer. */
    static sanitizeString = stringUtils.sanitizeString;
    /** Converts a string to a string of its ASCII character codes. */
    static stringToASCII = stringUtils.stringToASCII;
    /** Converts a string to an array of numbers representing its byte values. */
    static stringToBytesArrayOfNumbers = stringUtils.stringToBytesArrayOfNumbers;

    // --- Base Conversions (from base-convert.ts) ---
    /** Converts a Uint8Array to a hexadecimal string. */
    static bytesToHexString = baseConvert.bytesToHexString;
    /** Encodes a Uint8Array into a Base58 string. */
    static bytesToBase58 = baseConvert.bytesToBase58;
    /** Decodes a Base58 string into a Uint8Array. */
    static base58ToBytes = baseConvert.base58ToBytes;
    /** Encodes a string into a standard Base64 string (with padding). */
    static stringToStdBase64 = baseConvert.stringToStdBase64;
    /** Converts a standard Base64 string to a Base64URL string. */
    static base64ToBase64Url = baseConvert.base64ToBase64Url;
    /** Encodes a string into a Base64URL string. */
    static stringToBase64Url = baseConvert.stringToBase64Url;
    /** Converts a Base64URL string to a standard Base64 string. */
    static base64UrlToBase64 = baseConvert.base64UrlToBase64;
    /** Decodes a string that is either Base64 or Base64URL into a Uint8Array. */
    static base64ToBytes = baseConvert.base64OrUrlSafeToBytes;
    /** Encodes a Uint8Array into a standard Base64 string (with padding). */
    static bytesToBase64 = baseConvert.bytesToBase64;
    /** Encodes a Uint8Array into a raw Base64URL string (no padding). */
    static bytesToRawBase64UrlSafe = baseConvert.bytesToRawBase64UrlSafe;

    // --- Object & Array Conversions (from object-convert.ts) ---
    /** Compares two arrays and returns true if they are the same, false otherwise. */
    static arrayCompare = objectConvert.arrayCompare;
    /** Merges two Uint8Arrays into a single Uint8Array. */
    static arrayMerge = objectConvert.arrayMerge;
    /** Serializes a JavaScript object to a Uint8Array of UTF-8 bytes. */
    static objectToBytes = objectConvert.objectToBytes;
    /** Serializes a JavaScript object to a raw Base64URL string. */
    static objectToRawBase64UrlSafe = objectConvert.objectToRawBase64UrlSafe;
    /** Deserializes a Base64URL string back into a JavaScript object. */
    static base64UrlSafeToJSON = objectConvert.base64UrlSafeToJSON;
}
