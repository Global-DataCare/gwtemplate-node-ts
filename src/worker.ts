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
      
      // 3. Encrypt the final response for the original requester.
      const recipientKey = job.meta?.jwe?.header?.jwk;
      if (!recipientKey) {
        throw new Error(`Cannot encode response: sender's public key (jwk) not found in original request JWE header.`);
      }

      // Determine the vaultId of the entity issuing the response.
      const senderVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);
      
      return this.kmsService.encodeResponse(payloadResponse, [recipientKey], senderVaultId);
      
    } catch (error: any) {
      console.error(`[Worker Job '${jobName}' failed for thid ${job.input?.thid}]`, error.message);
      
      const errorBundle = createErrorBundle(error.message, jobInfo?.action, job.input?.body?.data?.[0]?.type);
      const errorResponse = {
        thid: job.input?.thid || 'unknown-thid',
        iss: composeHostDidWebId(this.apiBaseUrl),
        aud: job.input?.iss || 'unknown-aud',
        exp: Math.floor(Date.now() / 1000) + 300,
        body: errorBundle,
      };

      // Also encrypt error responses.
      const recipientKey = job.meta?.jwe?.header?.jwk;
      if (!recipientKey) {
        throw new Error(`Cannot encode error response: sender's public key not found.`);
      }

      // The issuer of a catastrophic error is always the host.
      return this.kmsService.encodeResponse(errorResponse, [recipientKey], 'host');
    }
  }
}