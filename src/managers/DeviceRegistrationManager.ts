// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/DeviceRegistrationManager.ts

import { validate as uuidValidate, v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { JobRequest } from '../models/confidential-job';
import { BundleJsonApi, BundleEntry, ErrorEntry } from '../models/bundle';
import { composeHostDidWebId } from '../utils/did';
import { ManagerError } from '../models/errors/manager-error';
import { IssueType, IssueLevel } from '../models/fhir/codes';
import { createOperationOutcome } from '../utils/outcome';
import { DcrRegistrationRequest, DcrRegistrationResponse } from '../models/openid-device';
import { IPayloadResponse } from '../models/confidential-message';

/**
 * Manages the business logic for a single device registration (DCR) request,
 * following the OpenID Connect Dynamic Client Registration 1.0 standard.
 */
export class DeviceRegistrationManager implements IJobProcessor {
  private readonly apiBaseUrl: string;

  // In the future, we'll inject dependencies like IVaultRepository and a client registry service.
  constructor(apiBaseUrl: string) {
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Processes a single device registration job based on OIDC DCR.
   * @param job The incoming job request containing the DCR payload.
   * @returns A promise resolving to a JARM-compliant response payload.
   */
  public async process(job: JobRequest): Promise<IPayloadResponse> {
    let responseEntry: BundleEntry | ErrorEntry;
    const entryType = job.content?.type || 'openid-dcr-request';

    try {
      const code = job.content?.body?.code;
      const registrationRequest = job.content?.body as DcrRegistrationRequest;

      // --- Validation Step ---
      this.validateRequest(code, registrationRequest);

      // (Future) Here you would:
      // - Validate the activation code against a database.
      // - Persist the client registration details (client_id, jwks, device_info)
      //   in a dedicated client registry, associated with the user/profile.
      const deviceInfo = registrationRequest.ext_device_info;
      if (deviceInfo) {
        console.log(`[DCR] Registering client with custom device info: ${deviceInfo.device_name}`);
      }

      // --- Client Creation Step ---
      const clientId = uuidv4();
      const clientIdIssuedAt = Math.floor(Date.now() / 1000);
      
      const registrationResponse: DcrRegistrationResponse = {
        client_id: clientId,
        client_id_issued_at: clientIdIssuedAt,
        // For this flow, we are not issuing a client_secret as authentication is based on the client's public keys (JWKS).
        client_secret_expires_at: 0, 
        // Example registration URI. This should point to where the client config can be managed.
        registration_client_uri: `${this.apiBaseUrl}/clients/${clientId}`,
      };

      // --- Response Formatting Step ---
      responseEntry = {
        type: entryType,
        response: { status: '201' }, // HTTP 201 Created
        resource: {
          resourceType: 'DeviceRegistration', // A descriptive resource type
          id: clientId,
          // The standard DCR response is embedded directly here.
          ...registrationResponse
        }
      };

    } catch (error) {
      responseEntry = this.handleError(error, entryType, job.content?.meta);
    }

    const responseBundle: BundleJsonApi = {
      data: [responseEntry],
      resourceType: 'Bundle',
      total: 1,
      type: 'transaction-response',
    };

    const issuerDid = composeHostDidWebId(this.apiBaseUrl);

    return {
      jti: uuidv4(),
      type: 'openid-dcr-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  /**
   * Validates the incoming activation code and DCR request payload.
   * @throws {ManagerError} if any validation fails.
   */
  private validateRequest(code: any, request: DcrRegistrationRequest): void {
    // 1. Validate Activation Code
    if (!code || typeof code !== 'string') {
      throw new ManagerError('Activation code is missing or empty', IssueType.Required);
    }
    if (!uuidValidate(code)) {
      throw new ManagerError('Activation code is not a valid UUID', IssueType.Value);
    }

    // 2. Validate DCR Payload (as per OIDC DCR spec)
    if (!request) {
      throw new ManagerError('Request body is missing', IssueType.Required);
    }
    if (!request.redirect_uris || !Array.isArray(request.redirect_uris) || request.redirect_uris.length === 0) {
      throw new ManagerError('`redirect_uris` is a required field and must be a non-empty array.', IssueType.Value);
    }
    if ((!request.jwks || !request.jwks.keys || request.jwks.keys.length === 0) && !request.jwks_uri) {
      throw new ManagerError('Either `jwks` or `jwks_uri` is a required field.', IssueType.Value);
    }
    if (request.application_type && request.application_type !== 'native') {
        throw new ManagerError(`Unsupported application_type: '${request.application_type}'. Only 'native' is supported.`, IssueType.Value);
    }
  }

  /**
   * Handles errors, converting them into a standard ErrorEntry format.
   */
  private handleError(error: any, entryType: string, meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType, meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    }
    console.error('[DeviceRegistrationManager] Unexpected error:', error);
    return {
      type: entryType, meta,
      response: {
        status: '500',
        outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
      },
    };
  }
}
