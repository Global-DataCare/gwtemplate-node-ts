// src/worker.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor, ManagerRegistry } from './managers/registry';
import { createErrorBundle } from './utils/bundle';
import { JobRequest } from './models/request';
import { parseJobName } from './utils/naming';
import { composeHostDidWebId } from './utils/did';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { getTenantVaultId } from './utils/tenant';
import { ConfidentialStorageDoc } from './models/confidential-storage';

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
   * and then protects or encodes it before returning the final artifact.
   * @returns A string representation of the final result, either a Compact JWE or a stringified ConfidentialStorageDoc.
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

      // --- 5. Final Response Encoding ---
      // The worker MUST always return a string. The format of the string depends on the
      // original request's flow (FAPI or Legacy).

      if (job.contentType?.includes('json')) {
        /**
         * @architecture LEGACY FLOW
         * The response payload is protected for at-rest storage. To do this, it MUST
         * be wrapped in a structure conforming to `ConfidentialStorageDoc` before
         * being passed to the KMS. The resulting object is then stringified for the queue.
         */
        const vaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector!, job.tenantId!);
        const docToProtect: ConfidentialStorageDoc = {
          id: 'response-payload', // A placeholder ID for the content within the doc
          sequence: 0,
          content: payloadResponse,
        };
        const protectedDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
        return JSON.stringify(protectedDoc);
      } else {
        /**
         * @architecture FAPI FLOW
         * The response is encoded for the original external caller using their public key
         * provided in the initial JWE header.
         */
        const recipientPublicKey = job.meta?.jwe?.header?.jwk;
        if (!recipientPublicKey) {
          throw new Error('Cannot encode response: Missing recipient public key (jwk) from original request.');
        }
        const senderVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector!, job.tenantId!);
        return this.kmsService.encodeResponse(payloadResponse, [recipientPublicKey], senderVaultId);
      }
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

      // Also attempt to protect error responses, ensuring consistency in return type.
      const recipientKey = job.meta?.jwe?.header?.jwk;
      if (recipientKey) {
        return this.kmsService.encodeResponse(errorResponse, [recipientKey], 'host');
      } else {
        // For legacy flow errors, we follow the same "wrap -> protect -> stringify" pattern.
        const vaultId = job.tenantId && job.sector ? (job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId)) : 'host';
        const docToProtect: ConfidentialStorageDoc = {
          id: 'error-response',
          sequence: 0,
          content: errorResponse,
        };
        const protectedError = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
        return JSON.stringify(protectedError);
      }
    }
  }
}