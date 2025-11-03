// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/auth.ts

/**
 * Defines the structure of the claims object decoded from a bearer access token.
 * This object is typically attached to the request object by an authentication middleware.
 */
export interface IAccessTokenClaims {
  /**
   * Issuer of the token (e.g., the DID of the issuing tenant).
   * This is the source of truth for identifying the tenant.
   */
  iss: string;
  /**
   * Subject of the token (e.g., the DID of the employee).
   */
  sub: string;
  /**
   * Audience for which the token is intended.
   */
  aud: string;
  /**
   * Expiration time (Unix timestamp).
   */
  exp: number;
  /**
   * Issued at time (Unix timestamp).
   */
  iat: number;
  /**
   * The scope of permissions granted by the token.
   */
  scope: string;
  /**
   * Client ID - The client that requested the token.
   */
  client_id: string;
}
