// utils/multibase58.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import baseX from "base-x";

const BASE58_BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58btc = baseX(BASE58_BTC_ALPHABET);

/**
 * Encode bytes into multibase base58btc string (prefixed with 'z').
 * Equivalent to multiformats base58btc.encode.
 */
export function encodeMultibase58btc(data: Uint8Array): string {
  return "z" + base58btc.encode(data);
}

/**
 * Decode a multibase base58btc string (must start with 'z').
 * Equivalent to multiformats base58btc.decode.
 */
export function decodeMultibase58btc(multibaseStr: string): Uint8Array {
  if (!multibaseStr.startsWith("z")) {
    throw new Error("Invalid multibase58btc string: missing 'z' prefix");
  }
  return base58btc.decode(multibaseStr.slice(1));
}

// HEX ➜ multibase base58btc (quita guiones si los hay)
export function encodeHexToMultibase58btc(hexStr: string): string {
  const hexClean = hexStr.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/i.test(hexClean)) throw new Error("Invalid 16-byte hex string");
  const bytes = new Uint8Array(hexClean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  return encodeMultibase58btc(bytes);
}

// multibase base58btc ➜ hex (no hyppens)
export function decodeMultibase58btcToHex(b58str: string): string {
  const bytes = decodeMultibase58btc(b58str);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// multibase base58btc ➜ UUID (with hyppens)
export function decodeMultibase58btcToUUID(b58str: string): string {
  const hex = decodeMultibase58btcToHex(b58str);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
