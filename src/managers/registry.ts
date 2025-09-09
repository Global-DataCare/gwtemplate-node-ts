// src/managers/registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantCacheManager } from './TenantMemManager';
import { JobRequest } from '@/models/request';
import { IPayloadResponse } from '@/models/response';

/**
 * Defines the standard contract for any manager that processes a job.
 */
export interface IJobProcessor {
  /**
   * The main processing method for a manager.
   * @param job The complete, authenticated, and authorized job request.
   * @returns A promise that resolves to the JARM-compliant response payload.
   */
  process(job: JobRequest): Promise<IPayloadResponse>;
}

/**
 * A centralized registry of all manager instances in the application.
 * This is used for dependency injection into the worker.
 * Note: Not all managers may process jobs (e.g., TenantMemManager might be synchronous).
 */
export interface ManagerRegistry {
  organizationManager: IJobProcessor;
  tenantManager: TenantCacheManager;
  employeeManager?: IJobProcessor;
  customerManager?: IJobProcessor;
  // groupManager?: IJobProcessor;
  // listManager?: IJobProcessor;
}
