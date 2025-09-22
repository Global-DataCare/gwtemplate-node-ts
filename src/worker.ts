// src/worker.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor, ManagerRegistry } from './managers/registry';
import { createErrorBundle } from './utils/bundle';
import { IPayloadResponse } from './models/response';
import { JobRequest } from './models/request';
import { parseJobName } from './utils/naming';
import { getHostDidWebId } from './utils/did';

/**
 * The Worker is the heart of the background processing logic.
 * It is a dedicated layer that acts as a Job Router, completely
 * decoupling the Queue Adapter from the business logic managers.
 */
export class Worker {
  private managers: ManagerRegistry;

  constructor(managers: ManagerRegistry) {
    this.managers = managers;
  }

  /**
   * The main processing function. It takes a job, analyzes its name, and routes it to the correct manager.
   * @param jobName The unique name of the job.
   * @param job The job payload.
   * @returns The complete, JARM-compliant response payload, ready for encryption.
   */
  public async process(jobName: string, job: JobRequest): Promise<IPayloadResponse> {
    const jobInfo = parseJobName(jobName);
    
    try {
      if (!jobInfo) {
        throw new Error(`Invalid job name format: '${jobName}'`);
      }
      if (!job.tenantId) {
        throw new Error('Job is missing required tenantId.');
      }

      const { resourceType } = jobInfo;
      let manager: IJobProcessor | undefined;

      // 1. Route to the appropriate manager based on the parsed job name
      switch (resourceType) {
        case 'Organization':
          manager = this.managers.organizationManager;
          break;
        case 'Practitioner': // Employee
          manager = this.managers.employeeManager;
          break;
        case 'Customer':
          manager = this.managers.customerManager;
          break;
        default:
          throw new Error(`No manager configured for resourceType '${resourceType}'`);
      }

      if (!manager) {
        throw new Error(`Manager for '${resourceType}' is registered but not initialized.`);
      }

      // 2. Delegate the entire job to the selected manager
      // The manager is responsible for all business logic and for building the response payload.
      return await manager.process(job);

    } catch (error: any) {
      console.error(`[Worker Job '${jobName}' failed for thid ${job.input?.thid}]`, error.message);
      
      // 3. In case of a catastrophic failure, create a fatal error response payload.
      const errorBundle = createErrorBundle(error.message, jobInfo?.action, job.input?.body?.data?.[0]?.type);
      
      return {
        thid: job.input?.thid || 'unknown-thid',
        iss: getHostDidWebId(),
        aud: job.input?.aud || 'unknown-aud',
        exp: Math.floor(Date.now() / 1000) + 300,
        body: errorBundle,
      };
    }
  }
}
