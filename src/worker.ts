// src/worker.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor, ManagerRegistry } from './managers/registry';
import { createErrorBundle } from './utils/bundle';
import { JobRequest } from './models/request';
import { parseJobName } from './utils/naming';
import { composeHostDidWebId } from './utils/did';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { getTenantVaultId } from './utils/tenant';

/**
 * The Worker is the heart of the background processing logic.
 * It is a dedicated layer that acts as a Job Router and Response Encryptor,
 * decoupling the Queue Adapter from the business logic managers.
 */
export class Worker {
  private managers: ManagerRegistry;
  private apiBaseUrl: string;
  private kmsService: IKmsService;

  constructor(managers: ManagerRegistry, apiBaseUrl: string, kmsService: IKmsService) {
    this.managers = managers;
    this.apiBaseUrl = apiBaseUrl;
    this.kmsService = kmsService;
  }

  /**
   * Processes a job, gets the plaintext response from the appropriate manager,
   * and then encrypts it before returning the final artifact.
   * @returns The final, encrypted JWE response as a string.
   */
  public async process(jobName: string, job: JobRequest): Promise<string> {
    const jobInfo = parseJobName(jobName);
    try {
      if (!jobInfo) {
        throw new Error(`Invalid job name format: '${jobName}'`);
      }
      if (!job.tenantId || !job.sector) {
        throw new Error('Job is missing required tenantId or sector.');
      }

      const { resourceType } = jobInfo;
      let manager: IJobProcessor | undefined;

      // 1. Route to the appropriate manager based on the parsed job name
      switch (resourceType) {
        case 'Organization':
          manager = this.managers.hostingManager;
          break;
        case 'Practitioner':
        case 'Employee':
          manager = this.managers.employeeManager;
          break;
        case 'Customer':
        case 'Person':
          manager = this.managers.customerManager;
          break;
        case 'Composition':
          manager = this.managers.compositionManager;
          break;
        case 'Communication':
          manager = this.managers.communicationManager;
          break;
        default:
          throw new Error(`No manager configured for resourceType '${resourceType}'`);
      }

      if (!manager) {
        throw new Error(`Manager for '${resourceType}' is registered but not initialized.`);
      }

      // 2. Delegate to the manager to get the plaintext response.
      const payloadResponse = await manager.process(job);

      // 3. Determine the vaultId of the job's issuer.
      const senderVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);

      // --- Response Encryption Logic ---
      // This section determines how the final response payload is encrypted before being stored for polling.

      // Case 1: Standard Secure Flow (request included a public key for the response)
      // The request was encrypted, so the response is encrypted for the original requester's public key.
      if (job.meta?.jwe?.header?.jwk) {
        const recipientKey = job.meta.jwe.header.jwk;
        return this.kmsService.encodeResponse(payloadResponse, [recipientKey], senderVaultId);
      }
      
      // Case 2: Unencrypted "Legacy" Flow (e.g., application/json)
      // The request was plaintext, but the response MUST be encrypted before storage.
      // The response is encrypted for the tenant processing the job (or the new tenant in case of creation).
      if (job.contentType?.startsWith('application/json') || job.contentType?.startsWith('application/fhir+json')) {
        let recipientVaultId: string;
        let responseSenderVaultId: string = senderVaultId;

        if (jobInfo.resourceType === 'Organization' && job.tenantId === 'host') {
          // Special Subcase: A new tenant is being created.
          // The response must be encrypted for the NEW tenant. The sender is the host.
          const newTenantClaims = job.content?.body?.data?.[0]?.meta?.claims;
          if (!newTenantClaims) {
            throw new Error('Cannot determine new tenant from job claims to encrypt response.');
          }
          const newTenantId = newTenantClaims['org.schema.Organization.alternateName'] as string;
          const newTenantSector = newTenantClaims['org.schema.Service.category'] as string;
          
          if (!newTenantId || !newTenantSector) {
            throw new Error('Missing alternateName or category in new tenant claims for encryption.');
          }
          recipientVaultId = getTenantVaultId(newTenantSector, newTenantId);
          responseSenderVaultId = 'host';
        } else {
          // General Subcase: An existing tenant is processing a job for itself.
          // The response is encrypted for the tenant who initiated the job.
          recipientVaultId = senderVaultId;
        }

        const recipientKeys = await this.kmsService.getPublicJwks(recipientVaultId);
        if (!recipientKeys || !recipientKeys.keys || recipientKeys.keys.length === 0) {
          throw new Error(`Could not retrieve public keys for recipient vault '${recipientVaultId}'`);
        }
        return this.kmsService.encodeResponse(payloadResponse, recipientKeys.keys, responseSenderVaultId);
      }

      // Fallback: If content type is unknown or there's no encryption key, throw an error.
      throw new Error(`Unsupported job content type or missing encryption key for job: ${jobName}`);
      
    } catch (error: any) {
      console.error(`[Worker Job '${jobName}' failed for thid ${job.content?.thid}]`, error.message);
      
      const errorBundle = createErrorBundle(error.message, jobInfo?.action, job.content?.body?.data?.[0]?.type);
      const errorResponse = {
        thid: job.content?.thid || 'unknown-thid',
        iss: composeHostDidWebId(this.apiBaseUrl),
        aud: job.content?.iss || 'unknown-aud',
        exp: Math.floor(Date.now() / 1000) + 300,
        body: errorBundle,
      };

      // Also attempt to encrypt error responses if a key is available.
      const recipientKey = job.meta?.jwe?.header?.jwk;
      if (recipientKey) {
        // The issuer of a catastrophic error is always the host.
        return this.kmsService.encodeResponse(errorResponse, [recipientKey], 'host');
      } else {
        // If no key is available (unencrypted flow or pre-decryption error), return the plaintext error.
        return JSON.stringify(errorResponse);
      }
    }
  }
}