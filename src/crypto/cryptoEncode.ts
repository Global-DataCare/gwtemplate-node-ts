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
  