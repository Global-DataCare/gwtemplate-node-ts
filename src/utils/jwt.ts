// src/utils/jwt.ts

// Use `import * as pako` to ensure compatibility with CommonJS/ESM module resolution.
// This resolves a stubborn TypeScript error (`esModuleInterop`) during testing.
import * as pako from 'pako';
import { Content } from './content';
import { DataCompactJWT, JwtCompactParts } from '../models/jwt';

// --- JWT Parsing and Decoding ---

/**
 * Splits a compact JWT string into its three parts.
 * @param compactToken The compact JWT string.
 * @returns A PartsJWT object or undefined if the format is invalid.
 */
export function getPartsJWT(compactToken: string | undefined): JwtCompactParts | undefined {
  if (!compactToken) {
    return undefined;
  }
  const parts = compactToken.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  return {
    protected: parts[0],
    payload: parts[1],
    signature: parts[2],
  };
}

/**
 * Decodes the Base64Url header of a JWT into a JSON object.
 * @param headerB64Url The Base64Url-encoded header string.
 * @returns A JSON object representing the header claims.
 */
export function decodeHeader(headerB64Url: string): any {
  try {
    const headerBytes = Content.base64ToBytes(headerB64Url);
    const headerString = Content.bytesToStringASCII(headerBytes);
    return JSON.parse(headerString);
  } catch (e) {
    console.error(`Cannot decode JWT header: ${e}`);
    return {};
  }
}

/**
 * Decodes the payload of a JWT, decompressing it if necessary.
 * @param payloadB64Url The Base64Url-encoded payload string.
 * @param isDeflated True if the payload is compressed with DEFLATE.
 * @returns The decoded payload as a JSON object.
 */
export async function decodePayload(payloadB64Url: string, isDeflated?: boolean): Promise<object> {
  try {
    let payloadBytes = Content.base64ToBytes(payloadB64Url);
    if (isDeflated) {
      payloadBytes = pako.inflate(payloadBytes);
    }
    // CRITICAL: The output of a decompression library like pako is a raw binary
    // stream. It is NOT guaranteed to be valid UTF-8. Using the strict
    // `bytesToStringUTF8` can fail. `bytesToStringASCII` is a more permissive
    // decoder that is robust enough to handle this binary data and convert it
    // to a string that can be safely parsed by `JSON.parse()`.
    const payloadString = Content.bytesToStringASCII(payloadBytes);
    return JSON.parse(payloadString);
  } catch (e) {
    console.error(`Cannot decode JWT payload: ${e}`);
    return {};
  }
}

/**
 * Fully decodes a compact JWT into a DataCompactJWT object with JSON headers and payload.
export async function getDataJWT(compactJWT: string | undefined): Promise<DataCompactJWT | undefined> {
 * @returns A (compact) JWT object or undefined if parsing fails.
 */
export async function getDataJWT(compactJWT: string | undefined): Promise<DataCompactJWT | undefined> {
  const parts = getPartsJWT(compactJWT);
  if (!parts) {
    return undefined;
  }

  const header = decodeHeader(parts.protected);
  const isDeflated = header.zip === 'DEF';
  const payload = await decodePayload(parts.payload, isDeflated);
  
  return {
    protected: header,
    payload,
    signature: parts.signature ? Content.base64ToBytes(parts.signature) : undefined,
  };
}


// --- JWT Creation and Encoding ---

/**
 * Encodes a JSON object into a Base64Url string.
 * @param header The header object.
 * @returns The encoded string.
 */
export function encodeHeader(header: object): string {
  try {
    return Content.objectToRawBase64UrlSafe(header);
  } catch (e) {
    console.warn('Cannot encode JWT header', e);
    return '';
  }
}

/**
 * Encodes a JSON object into a Base64Url payload, compressing it if required.
 * @param payload The payload object.
 * @param deflate True to compress the payload with DEFLATE.
 * @returns The encoded string.
 */
export async function encodePayload(payload: object, deflate?: boolean): Promise<string> {
  try {
    // CRITICAL: When creating a payload, we start with a JSON string, which IS
    // valid UTF-8. We must use the strict `stringToBytesUTF8` encoder to ensure
    // standards compliance.
    let payloadBytes = Content.stringToBytesUTF8(JSON.stringify(payload));
    if (deflate) {
      payloadBytes = pako.deflate(payloadBytes);
    }
    return Content.bytesToRawBase64UrlSafe(payloadBytes);
  } catch (e) {
    console.warn('Cannot encode JWT payload', e);
    return '';
  }
}

/**
 * Encodes a signature byte array into a Base64Url string.
 * @param signatureBytes The signature bytes.
 * @returns The encoded string, or an empty string if no signature is provided.
 */
export function encodeSignature(signatureBytes?: Uint8Array): string {
  if (!signatureBytes || signatureBytes.length < 1) {
    return '';
  }
  try {
    return Content.bytesToRawBase64UrlSafe(signatureBytes);
  } catch (e) {
    console.warn('Cannot encode JWT signature', e);
    return '';
  }
}

/**
 * Assembles a header, payload, and signature into a compact JWT string.
 * @param header The header object.
 * @param payload The payload object.
 * @param signatureBytes The optional signature.
 * @returns A compact JWT string.
 */
export async function compactJWT(header: object, payload: object, signatureBytes?: Uint8Array): Promise<string> {
  const encodedHeader = encodeHeader(header);
  const isDeflated = (header as any).zip === 'DEF';
  const encodedPayload = await encodePayload(payload, isDeflated);
  const encodedSignature = encodeSignature(signatureBytes);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

