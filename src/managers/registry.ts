// src/managers/registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantMemManager } from './TenantMemManager';
import { EmployeeManager } from './EmployeeManager';
import { CustomerManager } from './CustomerManager';
import { GroupManager } from './GroupManager';
import { ListManager } from './ListManager';
import { Bundle } from '../models/bundle';
import { ManagerResult } from '../models/manager-result';
import { OrganizationManager } from './OrganizationManager';

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
  organizationManager: OrganizationManager;
  tenantManager: TenantMemManager;
  // Mark managers that are not fully implemented yet as optional.
  // This allows us to build the application with only the finished components.
  employeeManager?: EmployeeManager;
  customerManager?: CustomerManager;
  groupManager?: GroupManager;
  listManager?: ListManager;
}

