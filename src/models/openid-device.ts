// src/models/openid-device.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @fileoverview Defines data models for device registration based on OpenID Connect Dynamic Client Registration 1.0,
 * with custom extensions for native device information.
 * @see https://openid.net/specs/openid-connect-registration-1_0.html
 */

import { JwkSet } from './jwk';

/**
 * Represents the information about the physical device being registered.
 * This is a custom extension to the OpenID DCR standard.
 */
export interface DeviceInfo {
  /**
   * The push notification token for the device.
   * @example "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
   */
  push_token: string;

  /**
   * The push notification provider.
   * @example "expo"
   */
  push_provider: string;

  /**
   * A unique identifier for the device, such as the OS internal build ID.
   * @example "19.6.0"
   */
  device_id: string;

  /**
   * A user-friendly name for the device.
   * @example "John's iPhone"
   */
  device_name: string;
}

/**
 * Represents the request payload for Dynamic Client Registration,
 * based on OpenID Connect Registration 1.0.
 * The `body` of the DIDComm message will contain this object.
 * @see https://openid.net/specs/openid-connect-registration-1_0.html#RegistrationRequest
 */
export interface DcrRegistrationRequest {
  // --- Standard OIDC DCR Fields ---

  /**
   * Array of redirection URIs for use in redirect-based flows. For a native app,
   * this could be a custom scheme URI.
   * @example ["myapp://callback"]
   */
  redirect_uris: string[];

  /**
   * Kind of the application. The only supported value is 'native'.
   */
  application_type?: 'native';
  
  /**
   * Human-readable name of the client to be presented to the end-user.
   * @example "My Awesome App"
   */
  client_name?: string;

  /**
   * URL of the home page of the client.
   */
  client_uri?: string;

  /**
   * Requested authentication method for the token endpoint.
   * For apps using public keys, 'private_key_jwt' is common.
   * 'none' can be used for public clients.
   */
  token_endpoint_auth_method?: 'none' | 'private_key_jwt';

  /**
   * A list of OAuth 2.0 grant types that the client will restrict itself to using.
   */
  grant_types?: ('authorization_code' | 'implicit' | 'refresh_token' | 'client_credentials')[];

  /**
   * URL for the client's JSON Web Key Set [JWK] document. If the client signs requests to the Server,
   * it contains the signing key(s) the Server uses to validate signatures from the Client.
   */
  jwks_uri?: string;

  /**
   * JSON Web Key Set containing the client's public keys.
   * REQUIRED if `jwks_uri` is not provided.
   */
  jwks?: JwkSet; 

  // --- Custom Extension Fields ---

  /**
   * Custom data about the specific device instance being registered.
   * This is prefixed to avoid collision with standard fields.
   */
  ext_device_info?: DeviceInfo;
}

/**
 * Represents the response payload for a successful Dynamic Client Registration,
 * based on OpenID Connect Registration 1.0.
 * This object will be nested inside the `resource` of the final BundleEntry.
 * @see https://openid.net/specs/openid-connect-registration-1_0.html#RegistrationResponse
 */
export interface DcrRegistrationResponse {
  /**
   * Unique client identifier.
   */
  client_id: string;

  /**
   * Time at which the client_id was issued, represented as a Unix timestamp.
   */
  client_id_issued_at: number;
  
  /**
   * The client secret. For public clients or those using JWTs for client authentication,
   * this may not be returned.
   */
  client_secret?: string;
  
  /**
   * Time at which the client_secret will expire, represented as a Unix timestamp.
   * If 0, the secret does not expire.
   */
  client_secret_expires_at?: number;
  
  /**
   * A registration access token that can be used at the client configuration endpoint
   * to perform subsequent operations upon the client registration.
   */
  registration_access_token?: string;

  /**
   * URL of the client's configuration endpoint.
   */
  registration_client_uri?: string;
}
