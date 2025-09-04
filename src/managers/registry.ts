// src/managers/registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantMemManager } from './TenantMemManager';
import { EmployeeManager } from './EmployeeManager';
import { CustomerManager } from './CustomerManager';
import { GroupManager } from './GroupManager';
import { ListManager } from './ListManager';
import { Bundle } from '../models/bundle';
import { ManagerResult } from '../models/manager-result';

/**
 * Defines the contract for all managers that process bundles.
 */
export interface IBundleProcessor {
  processBundle(tenantId: string, bundle: Bundle): Promise<ManagerResult>;
}

/**
 * A centralized registry of all manager instances in the application.
 * This is used for dependency injection into the worker.
 */
export interface ManagerRegistry {
  tenantManager: TenantMemManager;
  employeeManager: EmployeeManager;
  customerManager: CustomerManager;
  groupManager: GroupManager;
  listManager: ListManager;
  // Add other managers here as they are created.
}
