// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/ITenantManager.ts

import { RecordBase } from "../models/resource-document";
import { TenantConfig } from "../models/tenant";
import { SchemaorgOrganizationParam } from "../models/params";

/**
 * Defines the contract for the Tenant Manager.
 * This service is responsible for loading and providing tenant configurations,
 * acting as a fast in-memory cache to resolve public identifiers to their
 * internal database context.
 */
export interface ITenantManager {
  /**
   * Loads all tenant configurations from the primary database into the in-memory cache.
   * This should be called on application startup.
   */
  loadTenants(): Promise<void>;
  /**
   * Retrieves a tenant's configuration using their public alternateName.
   * @param alternateName The public ID used in URLs (e.g., 'organization-1').
   * @returns The TenantConfig object, or null if not found.
   */
  getConfigByAlternateName(alternateName: string): TenantConfig | null;

  /**
   * Registers a new tenant in the system.
   * @param params The organization's details.
   * @returns The newly created TenantConfig object.
   */
  set(id: string, params: SchemaorgOrganizationParam): Promise<TenantConfig>;
  // registerNewTenant(params: SchemaorgOrganizationParam): Promise<TenantConfig>;
}

