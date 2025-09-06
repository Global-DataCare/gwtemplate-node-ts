// src/utils/convert.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * A utility class for converting between different data formats using Node.js native APIs.
 * This avoids dependencies that require complex Jest transformation configurations.
 */
export class Convert {

  /**
   * Encodes a JavaScript string into a Uint8Array using UTF-8 encoding via TextEncoder.
   * @param str The string to encode.
   * @returns A Uint8Array containing the UTF-8 bytes.
   */
  static stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  /**
   * Decodes a Uint8Array containing UTF-8 bytes back into a JavaScript string via TextDecoder.
   * @param bytes The Uint8Array to decode.
   * @returns The decoded JavaScript string.
   */
  static bytesToString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
  }

  /**
   * Encodes a Uint8Array into a Base64URL-safe string using Node.js Buffer.
   * @param bytes The byte array to encode.
   * @returns A Base64URL-encoded string.
   */
  static bytesToBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
  }

  /**
   * Decodes a Base64URL-safe string back into a Uint8Array using Node.js Buffer.
   * @param str The Base64URL-encoded string.
   * @returns The decoded Uint8Array.
   */
  static base64UrlToBytes(str: string): Uint8Array {
    return Buffer.from(str, 'base64url');
  }

  /**
   * Serializes a JavaScript object to a JSON string and then encodes it as Base64URL.
   * @param data The object to encode.
   * @returns A Base64URL-encoded string representing the JSON object.
   */
  static objectToBase64Url(data: object): string {
    const jsonString = JSON.stringify(data);
    return Buffer.from(jsonString, 'utf8').toString('base64url');
  }

  /**
   * Decodes a Base64URL string and parses it as a JSON object.
   * @param str The Base64URL-encoded string.
   * @returns The parsed JavaScript object.
   * @throws Will throw an error if the string is not valid Base64URL or not valid JSON.
   */
  static base64UrlToObject<T = any>(str: string): T {
    const jsonString = Buffer.from(str, 'base64url').toString('utf8');
    return JSON.parse(jsonString) as T;
  }
}
