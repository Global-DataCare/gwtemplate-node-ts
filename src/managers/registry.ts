// src/managers/registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from './TenantsCacheManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';

/**
 * Defines the standard contract for any manager that processes a job.
 */
export interface IJobProcessor {
  /**
   * The main processing method for a manager.
   * @param job The complete, authenticated, and authorized job request.
   * @returns A promise that resolves to the JARM-compliant response payload.
   */
  process(job: JobRequest): Promise<IDecodedDidcommPayload>;
}

/**
 * A centralized registry of all manager instances in the application.
 * This is used for dependency injection into the worker.
 * Note: Not all managers may process jobs (e.g., TenantMemManager might be synchronous).
 */
export interface ManagerRegistry {
  hostingManager: IJobProcessor;
  tenantManager: TenantsCacheManager;
  identityTokenManager?: IJobProcessor;
  observationManager?: IJobProcessor;
  relatedPersonManager?: IJobProcessor;
  familyManager?: IJobProcessor;
  employeeManager?: IJobProcessor;
  individualManager?: IJobProcessor;
  compositionManager?: IJobProcessor;
  communicationManager?: IJobProcessor;
  deviceRegistrationManager?: IJobProcessor;
  licenseManager?: IJobProcessor;
  openIdAuthManager?: IJobProcessor;
  // groupManager?: IJobProcessor;
  // listManager?: IJobProcessor;
}
