// src/models/response.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Bundle } from '../models/bundle';

/**
 * Defines the structure of the plaintext response payload that a manager MUST return.
 * This structure is compliant with JARM (JWT Secured Authorization Response Model)
 * and is intended to be the body of a DIDComm response message.
 */
export interface IPayloadResponse {
  /**
   * Issuer. A URI that identifies the principal that issued the response.
   * This will be the DID or URL of our service.
   */
  iss: string;

  /**
   * Audience. A URI identifying the principal that the response is intended for.
   * This will be the DID or client_id of the original requester.
   */
  aud: string;

  /**
   * Expiration time on or after which the response MUST NOT be accepted for processing.
   * Represented as a NumericDate (seconds since the epoch).
   */
  exp: number;

  /**
   * The Transaction ID (`thid`) from the original request, preserved for correlation.
   * Essential for DIDComm message threading.
   */
  thid: string;

  /**
   * The main body of the response, containing the results of the operation
   * structured as a Bundle.
   */
  body: any;
}
