// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.mem.repository.ts

import { IVaultRepository } from './vault.repository';
import { RecordBase, VaultConfig } from '../../../models/resource-document';
import { InMemoryVault } from '../../../models/repository';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';

/**
 * An in-memory implementation of the Vault Repository that faithfully mimics the
 * separation between logical `vaultId` and physical `collectionName` as defined
 * in the `IVaultRepository` interface and implemented by `FirestoreVaultRepository`.
 *
 * - `vaultExists` operates on logical `vaultId`s held in a dedicated registry.
 * - `createNewVault` operates on physical `collectionName`s.
 * - All other data manipulation methods (`put`, `get`, etc.) operate on the physical `collectionName`.
 */
export class VaultMemRepository implements IVaultRepository {
  // Maps physical collectionName -> InMemoryVault
  private dataVaults = new Map<string, InMemoryVault>();
  // Simulates the host's tenant registry, mapping logical vaultId -> registration document
  private tenantRegistry = new Map<string, ConfidentialStorageDoc>();

  /**
   * Clears all state to ensure clean test runs.
   */
  public clear(): void {
    this.dataVaults.clear();
    this.tenantRegistry.clear();
  }

  // === Methods from IVaultRepository ===

  public async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    const collectionName = vaultConfig.id; // Per architecture, vaultConfig.id IS the collectionName
    if (this.dataVaults.has(collectionName)) {
      return false;
    }
    this.dataVaults.set(collectionName, {
      config: vaultConfig,
      sections: new Map(),
    });
    return true;
  }

  public async vaultExists(vaultId: string): Promise<boolean> {
    // Per architecture, this checks for the logical registration entry.
    return this.tenantRegistry.has(vaultId);
  }

  public async getContainersInSection<T extends RecordBase>(
    collectionName: string,
    sectionId: string,
  ): Promise<T[]> {
    // Special Case for simulating TenantsCacheManager reading the registry.
    // The manager calls getContainersInSection('host', 'tenants'). This is a special
    // logical identifier that we resolve to our internal tenantRegistry.
    if (collectionName === 'host' && sectionId === 'tenants') {
      return Array.from(this.tenantRegistry.values()) as unknown as T[];
    }

    const vault = this.dataVaults.get(collectionName);
    const section = vault?.sections.get(sectionId);
    return section ? (Array.from(section.values()) as unknown as T[]) : [];
  }

  public async put<T extends RecordBase>(
    collectionName: string,
    containers: T[],
    sectionId: string = 'default',
  ): Promise<boolean> {
    // Special case: Writing TO the tenant registry. This happens when writing
    // to the host's physical collection in the 'tenants' section. The host's
    // physical collection is identified by containing '_system'.
    if (collectionName.includes('_system') && sectionId === 'tenants') {
      for (const doc of containers) {
        if (!doc.id) {
          throw new Error('Document must have a logical id to be placed in the tenant registry.');
        }
        this.tenantRegistry.set(doc.id, doc as unknown as ConfidentialStorageDoc);
      }
      return true;
    }

    const vault = this.dataVaults.get(collectionName);
    if (!vault) {
      console.error(`[VaultMemRepository] Cannot put data, physical vault not found: '${collectionName}'`);
      return false;
    }

    if (!vault.sections.has(sectionId)) {
      vault.sections.set(sectionId, new Map<string, RecordBase>());
    }

    const sectionMap = vault.sections.get(sectionId)!;

    for (const doc of containers) {
      if (!doc.id) {
        throw new Error('Document must have an id.');
      }
      sectionMap.set(doc.id, doc);
    }
    return true;
  }

  public async get<T extends RecordBase>(
    collectionName: string,
    containerId: string,
    sectionId: string = 'default',
  ): Promise<T | undefined> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section?.get(containerId) as unknown as T | undefined;
  }

  // ===================================================================================
  // Other IVaultRepository methods...
  // ===================================================================================

  public async getVaultConfig(collectionName: string): Promise<VaultConfig | undefined> {
    return this.dataVaults.get(collectionName)?.config;
  }

  public async createNewSection(collectionName: string, sectionId: string): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    if (!vault || vault.sections.has(sectionId)) {
      return false;
    }
    vault.sections.set(sectionId, new Map());
    return true;
  }

  public async updateSection(collectionName: string, sectionId: string, containers: RecordBase[] = []): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    if (!vault) {
      return false;
    }
    const newSection = new Map<string, RecordBase>();
    containers.forEach((doc) => newSection.set(doc.id, doc));
    vault.sections.set(sectionId, newSection);
    return true;
  }

  public async getAllSections(collectionName: string): Promise<string[]> {
    const vault = this.dataVaults.get(collectionName);
    return vault ? Array.from(vault.sections.keys()) : [];
  }

  public async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    return this.dataVaults.get(collectionName)?.sections.has(sectionId) ?? false;
  }

  public async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section ? Array.from(section.keys()) : [];
  }

  public async getHistory(collectionName: string, containerId: string): Promise<any[]> {
    console.warn('getHistory is not implemented in VaultMemRepository');
    return [];
  }

  public async query<T extends RecordBase>(
    collectionName: string,
    query: { sectionId: string; where: { attribute: string; equals: string }[] },
  ): Promise<T[]> {
    const section = this.dataVaults.get(collectionName)?.sections.get(query.sectionId);
    if (!section) {
      return [];
    }

    const allDocs = Array.from(section.values()) as ConfidentialStorageDoc[];

    const filteredDocs = allDocs.filter((doc) => {
      if (!doc.indexed?.attributes) {
        return false;
      }

      return query.where.every((condition) => {
        return doc.indexed!.attributes.some(
          (attr) => attr.name === condition.attribute && attr.value === condition.equals,
        );
      });
    });

    return filteredDocs as unknown as T[];
  }

  public async delete(collectionName: string, containerId: string, sectionId?: string): Promise<boolean> {
    console.warn('delete is not implemented in VaultMemRepository');
    return false;
  }

  public async purge(collectionName: string): Promise<boolean> {
    console.warn('purge is not implemented in VaultMemRepository');
    return false;
  }
}