// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/ITenantsManager.ts

import { DidService } from "../models/did";

/**
 * Defines the contract for the Tenants Manager cache.
 * This service is responsible for loading tenant data and providing fast,
 * read-only access to specific, un-sensitive parts of a tenant's configuration,
 * such as their public URN or service endpoints. It acts as a fast ID resolver.
 */
export interface ITenantsManager {
  /**
   * Loads all tenant configurations from the primary database into the in-memory cache.
   * This should be called on application startup.
   */
  loadTenants(): Promise<void>;

  /**
   * Retrieves a tenant's sovereign URN from the cache by its internal vaultId.
   * @param vaultId The internal vaultId of the tenant (e.g., 'health-care.tenant-1').
   * @returns The URN string or undefined if not found.
   */
  getTenantUrn(vaultId: string): string | undefined;

  /**
   * Retrieves a tenant's service configurations from the cache by its internal vaultId.
   * @param vaultId The internal vaultId of the tenant.
   * @returns An array of DidService configurations or undefined if not found.
   */
  getDidServiceConfig(vaultId: string): DidService[] | undefined;
}
