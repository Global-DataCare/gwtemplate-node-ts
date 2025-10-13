// src/utils/uuid.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Converts a UUID string (with or without hyphens) into a 16-byte Uint8Array.
 * @param uuidStr The UUID string to convert.
 * @returns A 16-byte Uint8Array representation of the UUID.
 * @throws {Error} if the input string is not a valid UUID format.
 */
export function uuidToBytes(uuidStr: string): Uint8Array {
  const hex = uuidStr.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('Invalid UUID string provided for byte conversion.');
  }
  
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
