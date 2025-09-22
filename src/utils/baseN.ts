/**
 * From https://raw.githubusercontent.com/digitalbazaar/base58-universal/master/baseN.js
 * Base-N/Base-X encoding/decoding functions.
 *
 * Original implementation from base-x:
 * https://github.com/cryptocoinjs/base-x
 *
 * Which is MIT licensed:
 *
 * The MIT License (MIT)
 *
 * Copyright base-x contributors (c) 2016
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
'use strict';

import { bytesToStringUTF8, stringToBytesUTF8 } from './string-convert';

// baseN alphabet indexes
const _reverseAlphabets: any = [];

// base58 characters (Bitcoin alphabet)
export const alphabetBase58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export class BaseN {
  constructor() { }

  /** BaseN-encodes a Uint8Array using the given alphabet */
  public static encodeN(input: Uint8Array, alphabet: string, maxline: string | undefined): string {
    return encodeN(input, alphabet, maxline);
  }

  /** Decodes a baseN-encoded (using the given alphabet) string to a Uint8Array. */
  public static decodeN(input: string, alphabet: string): Uint8Array {
    return decodeN(input, alphabet);
  }

  /** Base58-encodes a Uint8Array using the Bitcoin alphabet '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' */
  public static encodeBytesToBase58(inputBytes: Uint8Array): string {
    return encodeN(inputBytes, alphabetBase58, undefined);
  }

  /** Base58-encodes a Uint8Array using the Bitcoin alphabet '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' */
  public static encodeStrToBase58(inputStr: string): string {
    const inputBytes: Uint8Array = stringToBytesUTF8(inputStr);
    return this.encodeBytesToBase58(inputBytes);
  }

  /** Decodes a base58-encoded string to a Uint8Array (using the Bitcoin alphabet '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz') */
  public static decodeBytesFromBase58(base58Str: string): Uint8Array {
    return decodeN(base58Str, alphabetBase58);
  }

  /** Decodes a base58-encoded string to a Uint8Array (using the Bitcoin alphabet '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz') */
  public static decodeStrFromBase58(base58Str: string): string {
    const inputBytes: Uint8Array = this.decodeBytesFromBase58(base58Str);
    return bytesToStringUTF8(inputBytes);
  }

  // decodeToUtf8String = (utf8StringArg: string): string => decodeToUtf8String(utf8StringArg)

}


/**
  * BaseN-encodes a Uint8Array using the given alphabet.
  *
  * @param {Uint8Array} input the bytes to encode in a Uint8Array.
  * @param {number} maxline the maximum number of encoded characters per line to
  *          use, defaults to none.
  *
  * @return {string} the baseN-encoded output string.
  */
export function encodeN(input: Uint8Array, alphabet: string, maxline: string | undefined): string {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('"input" must be a Uint8Array.');
  }
  if (typeof alphabet !== 'string') {
    throw new TypeError('"alphabet" must be a string.');
  }
  if (maxline !== undefined && typeof maxline !== 'number') {
    throw new TypeError('"maxline" must be a number.');
  }
  if (input.length === 0) {
    return '';
  }

  let output: string = '';

  let i = 0;
  const base = alphabet.length;
  const first = alphabet.charAt(0);
  const digits = [0];
  for (i = 0; i < input.length; ++i) {
    let carry = input[i];
    for (let j = 0; j < digits.length; ++j) {
      carry += digits[j] << 8;
      digits[j] = carry % base;
      carry = (carry / base) | 0;
    }

    while (carry > 0) {
      digits.push(carry % base);
      carry = (carry / base) | 0;
    }
  }

  // deal with leading zeros
  for (i = 0; input[i] === 0 && i < input.length - 1; ++i) {
    output += first;
  }
  // convert digits to a string
  for (i = digits.length - 1; i >= 0; --i) {
    output += alphabet[digits[i]];
  }

  if (maxline) {
    const match = output.match(new RegExp('.{1,' + maxline + '}', 'g'));
    if (match) {
      output = match.join('\r\n');
    }
  }

  return output;
}

/**
  * Decodes a baseN-encoded (using the given alphabet) string to a
  * Uint8Array.
  *
  * @param {string} input the baseN-encoded input string.
  *
  * @return {Uint8Array} the decoded bytes in a Uint8Array.
  */
export function decodeN(input: string, alphabet: string): Uint8Array {
  if (typeof input !== 'string') {
    throw new TypeError('"input" must be a string.');
  }
  if (typeof alphabet !== 'string') {
    throw new TypeError('"alphabet" must be a string.');
  }
  if (input.length === 0) {
    return new Uint8Array(0);
  }

  let table = _reverseAlphabets[alphabet];
  if (!table) {
    // compute reverse alphabet
    table = _reverseAlphabets[alphabet] = [];
    for (let i = 0; i < alphabet.length; ++i) {
      table[alphabet.charCodeAt(i)] = i;
    }
  }

  // remove whitespace characters
  input = input.replace(/\s/g, '');

  const base = alphabet.length;
  const first = alphabet.charAt(0);
  const bytes = [0];
  for (let i = 0; i < input.length; i++) {
    const value = table[input.charCodeAt(i)];
    if (value === undefined) {
      return new Uint8Array(0); // empty
    }

    let carry = value;
    for (let j = 0; j < bytes.length; ++j) {
      carry += bytes[j] * base;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // deal with leading zeros
  for (let k = 0; input[k] === first && k < input.length - 1; ++k) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}