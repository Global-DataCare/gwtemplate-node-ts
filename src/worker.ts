// src/worker.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor, ManagerRegistry } from './managers/registry';
import { createErrorBundle } from './utils/bundle';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { parseJobName } from './utils/naming';
import { composeHostDidWebId } from './utils/did-backend';
import { IKmsService } from './gdc-backend-utils-node/models/IKmsService';
import { getTenantVaultId } from './utils/tenant';
import { JWK } from 'gdc-common-utils-ts/models/jwk';

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
          // Organization is overloaded:
          // - `registry/*/Organization` => host onboarding
          // - `individual/*/Organization` => family onboarding (household modeled as Organization)
          manager = job.section === 'individual' ? this.managers.familyManager : this.managers.hostingManager;
          break;
        case 'Order':
          // Orders follow the same routing as their corresponding onboarding flow.
          manager = job.section === 'individual' ? this.managers.familyManager : this.managers.hostingManager;
          break;
        case 'Practitioner':
        case 'Employee':
          manager = this.managers.employeeManager;
          break;
	        case 'Customer':
	        case 'Person':
	          manager = this.managers.individualManager;
	          break;
        case 'Composition':
          manager = this.managers.compositionManager;
          break;
        case 'DocumentReference':
          manager = this.managers.documentReferenceManager;
          break;
        case 'Consent':
          manager = this.managers.consentManager;
          break;
        case 'Communication':
          manager = this.managers.communicationManager;
          break;
        case 'Observation':
          manager = this.managers.observationManager;
          break;
        case 'RelatedPerson':
          manager = this.managers.relatedPersonManager;
          break;
        case 'Smart':
        case 'smart':
          manager = this.managers.openIdAuthManager;
          break;
        case 'Device':
          manager = this.managers.deviceRegistrationManager;
          break;
        case 'Token':
          manager = this.managers.identityTokenManager;
          break;
        case 'License':
          manager = this.managers.licenseManager;
          break;
        case 'csr':
          manager = this.managers.icaManager;
          break;
        case 'didcomm-plaintext':
        case 'didcomm-signed':
        case 'didcomm-encrypted':
          manager = this.managers.messagingManager;
          break;
        default:
          throw new Error(`No manager configured for resourceType '${resourceType}'`);
      }

      if (!manager) {
        throw new Error(`Manager for '${resourceType}' is registered but not initialized.`);
      }

      // 2. Delegate to the manager to get the plaintext response.
      const payloadResponse = await manager.process(job);

      // --- ARCHITECTURE KEEPER: UNIFIED RESPONSE ENCODING ---
      // The Worker MUST ALWAYS use `IKmsService.encodeResponse` to prepare the job result.
      // This guarantees that the AsyncResponseStore contains a consistent data type (a JWE string)
      // for the Polling Handler to process, eliminating an entire class of potential errors.
      // The `protectConfidentialData` method is strictly for long-term "at-rest" storage
      // in the main vault, not for in-transit responses like this.

      // We determine the intended recipient of the encrypted response based on the original request flow.
      const senderVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);
      let recipientJwks: JWK[];
      let responseSenderVaultId: string = senderVaultId;
      
      const isSecureFlow = String(job.contentType || '').startsWith('application/x-www-form-urlencoded');
      if (isSecureFlow && job.content?.meta?.jwe?.header?.jwk) {
        // --- FLOW A: FAPI / SECURE FLOW ---
        // The original request was a JWE and included the sender's public key (`jwk`).
        // We use that key to encrypt the response directly for them.
        recipientJwks = [job.content.meta.jwe.header.jwk];

      } else {
        // --- FLOW B: LEGACY / PLAINTEXT FLOW ---
        // The original request was unencrypted (e.g., application/json). We must still
        // encrypt the response for secure storage in the AsyncResponseStore.
        // The recipient is determined by the nature of the job.
        let recipientVaultId: string;
        if (jobInfo.resourceType === 'Organization' && job.tenantId === 'host') {
          // Special case (legacy plaintext onboarding):
          // Encrypt-to-host so the polling handler can always decrypt, even before the new tenant's keys exist.
          recipientVaultId = 'host';
          responseSenderVaultId = 'host';
        } else {
          // Default Case: An existing tenant is processing a job. Encrypt for the tenant itself.
          recipientVaultId = senderVaultId;
        }

        const encryptionKey = await this.kmsService.getPublicEncryptionKey(recipientVaultId);
        if (!encryptionKey) {
          throw new Error(`Could not retrieve public encryption key for recipient vault '${recipientVaultId}'`);
        }
        recipientJwks = [encryptionKey as JWK];
      }

      return this.kmsService.encodeResponse(payloadResponse, recipientJwks, responseSenderVaultId);
      
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

      // Also attempt to encrypt error responses, ensuring the Polling Handler always
      // gets a consistent data type if possible.
      const recipientKey = job.content?.meta?.jwe?.header?.jwk;
      if (recipientKey) {
        try {
          // The issuer of a catastrophic error is always the host.
          return await this.kmsService.encodeResponse(errorResponse, [recipientKey], 'host');
        } catch {
          return JSON.stringify(errorResponse);
        }
      } else {
        // In the legacy flow, we can't be sure who to encrypt for in an error case,
        // so we must return a plaintext JSON string. The polling handler MUST handle this.
        return JSON.stringify(errorResponse);
      }
    }
  }
}
