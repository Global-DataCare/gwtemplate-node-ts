// src/__tests__/data/ping.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DecodedDidcommMessage } from '../../models/request';

// A generic, encrypted JWE for use in form bodies during integration tests.
export const testEncryptedJwePing = 'eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIn0...';

// The plaintext content that the mock KMS service will "return" when it decodes the request.
// This structure is based on the unit test for PingManager to ensure consistency.
export const decodedPingMessage: DecodedDidcommMessage = {
  thid: 'ping-to-host-thid', // Descriptive thread ID
  // aud (Audience) is our service's DID.
  aud: 'did:web:recipient.example.com',
  // iss (Issuer) is the client's DID.
  iss: 'did:web:requester.example.com',
  response_type: 'json',
  type: 'json', // Per the unit test, this represents the message format.
  body: {
    data: [{
      type: 'ping-form-v1.0',
      meta: { claims: { ping: 'Hello World!' } },
    }],
  },
};

// A second decoded message for testing the tenant-specific route.
export const decodedTenantPingMessage: DecodedDidcommMessage = {
  ...decodedPingMessage,
  thid: 'ping-to-tenant1-thid', // Descriptive thread ID for the tenant
  aud: 'did:web:recipient.example.com:tenant1', // Audience is the tenant DID
};
