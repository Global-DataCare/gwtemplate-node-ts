// src/managers/cryptoEncode.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// Function to encode a payload into a JWT with the header "alg=none"
// senderTenant signs and encrypts to recipient(s)
export function encodeJWT(senderKeysSet: any[], payload: any, recipientsEncKey: any[], header: any): string {
    try {
      // 1. Convert the header to JSON and then Base64Url encode it
      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      
      // 2. Convert the payload to JSON and then Base64Url encode it
      const encodedPayload = base64UrlEncode(JSON.stringify(payload));
      
      // 3. No signature for `alg=none`, so we just return the concatenation of header and payload
      // Format: `header.payload.` (no signature part)
      const jwt = `${encodedHeader}.${encodedPayload}.`;
  
      return jwt;
    } catch (error) {
      console.error('Error encoding JWT:', error);
      return '';
    }
  }
  
  // Helper function to Base64Url encode a string (works for header and payload)
  function base64UrlEncode(str: string): string {
    // Convert the string to a Base64 string (using standard Base64 encoding first)
    const base64 = Buffer.from(str).toString('base64');
    
    // Replace '+' with '-', '/' with '_', and remove the padding '='
    return base64
      .replace(/\+/g, '-')  // Replace '+' with '-'
      .replace(/\//g, '_')  // Replace '/' with '_'
      .replace(/=+$/, '');   // Remove any '=' padding at the end
  }
  
  // src/managers/cryptoDecode.ts

// TODO: decode, verify, encode, sign, encrypt, decrypt, all of them must be in the wallet
// Note: each tenant can have their own wallet.
// Function to decode JWT and handle Base64Url using native JavaScript functions
export function decodePayloadRequest(targetTenant: string, requestJAR: string | undefined, authorizationHeader: string | undefined): any {
    try {
      let authToken: string | undefined;
      // TODO: auth token could be protected in the request: payload.body.meta.http.header.bearer.source
      // TODO: this function will decode the bearer (auth) token and set it here: payload.body.meta.http.header.bearer.decoded
      // TODO: first of all the request must be decrypted in case of JWE, then the nested JWT is decoded
      // If not in the JAR, look for auth token in the Authorization header (Bearer token)
      if (authorizationHeader) {
        authToken = authorizationHeader.replace('Bearer ', '').trim();
      }
  
      // If the token is not found, return an error
      if (!authToken) {
        throw new Error('No JWT found in request or Authorization header');
      }
  
      // Decode the JWT (Base64Url format as per the JOSE specification)
      const [header, payload, signature] = authToken.split('.');
  
      if (!payload) {
        throw new Error('JWT payload is missing');
      }
      const decodedPayload = decodeBase64Url(payload);
    
      // Return the decoded payload that contains the body and data
      return decodedPayload;
    } catch (error) {
      console.error('Error decoding JWT payload:', error);
      return null;
    }
  }

export function decodeBase64Url(base64Url: string): string {
  try {
    // Convert Base64Url to Base64 by replacing '-' with '+' and '_' with '/'
    let base64 = base64Url
      .replace(/-/g, '+')  // Replace '-' with '+'
      .replace(/_/g, '/'); // Replace '_' with '/'

    // Ensure that Base64 has the correct size (padding)
    const padding = base64.length % 4;
    if (padding) {
      base64 += '='.repeat(4 - padding); // Add the necessary padding
    }

    // Decode the Base64 string using Buffer (for Node.js)
    const decodedString = Buffer.from(base64, 'base64').toString('utf-8');

    // Check if decoding results in a valid JSON string
    try {
      JSON.parse(decodedString); // Ensure it's valid JSON
    } catch (e) {
      console.error('Invalid Base64Url string:', e);
      return ''; // Return empty string for invalid JSON payload
    }

    return decodedString;
  } catch (error) {
    console.error('Error decoding Base64Url string:', error);
    return ''; // Return empty string if there's an error during decoding
  }
}

