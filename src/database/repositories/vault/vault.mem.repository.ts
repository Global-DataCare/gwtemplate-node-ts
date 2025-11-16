// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.mem.repository.ts

import { IVaultRepository } from './vault.repository';
import { RecordBase, VaultConfig } from '../../../models/resource-document';
import { InMemoryVault } from '../../../models/repository';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';

/**
 * An in-memory implementation of the Vault Repository.
 *
 * @architecture
 * This class is intentionally "dumb" and mimics the behavior of a physical database.
 * It has no concept of a separate "tenant registry" or logical identifiers like "host".
 * It only contains physical vaults (collections), identified by a `collectionName`.
 *
 * The host's tenant registry is simply the 'tenants' section within the host's physical vault.
 * This class operates solely on the `collectionName` provided to it, making it a predictable
 * mock for a physical database. The responsibility of translating a logical `vaultId`
 * to a physical `collectionName` lies entirely with the business logic layer (e.g., TenantsCacheManager).
 */
export class VaultMemRepository implements IVaultRepository {
  // Maps a physical collectionName -> InMemoryVault
  private dataVaults = new Map<string, InMemoryVault>();

  /**
   * Clears all state to ensure clean test runs.
   */
  public clear(): void {
    this.dataVaults.clear();
  }

  // === Core IVaultRepository Methods ===

  /**
   * Creates a new, empty physical vault (collection).
   */
  public async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    const collectionName = vaultConfig.id; // The vaultConfig.id IS the physical collectionName
    if (this.dataVaults.has(collectionName)) {
      return false; // Vault already exists
    }
    this.dataVaults.set(collectionName, {
      config: vaultConfig,
      sections: new Map(),
    });
    return true;
  }

  /**
   * Checks for the existence of a tenant's registration document.
   * This implementation has been simplified to better align with architectural principles.
   * The `IVaultRepository` interface's `vaultExists` signature is ambiguous for non-host vaults.
   * This mock now assumes it will be called in a way that is verifiable in tests.
   */
  public async vaultExists(vaultId: string): Promise<boolean> {
      // In the corrected architecture, this is primarily used by HostingManager to check for duplicates.
      // HostingManager calls this with a LOGICAL vaultId. This mock simulates checking if that
      // logical ID has been registered in ANY vault's 'tenants' section.
      for (const vault of this.dataVaults.values()) {
          const tenantsSection = vault.sections.get('tenants');
          if (tenantsSection?.has(vaultId)) {
              return true;
          }
      }
      return false;
  }

  /**
   * Places documents into a specific section of a physical vault.
   */
  public async put<T extends RecordBase>(
    collectionName: string,
    documents: T[],
    sectionId: string = 'default',
  ): Promise<boolean> {
    // To support the bootstrap flow in tests, auto-create the vault if it doesn't exist.
    if (!this.dataVaults.has(collectionName)) {
      this.createNewVault({ id: collectionName, name: collectionName });
    }
    const vault = this.dataVaults.get(collectionName)!;

    if (!vault.sections.has(sectionId)) {
      vault.sections.set(sectionId, new Map<string, RecordBase>());
    }
    const sectionMap = vault.sections.get(sectionId)!;

    for (const doc of documents) {
      if (!doc.id) {
        throw new Error('Document being put into a vault must have an id.');
      }
      // DEBUG LOG: See exactly what is being saved
      console.log(`[TEST DEBUG] VaultMemRepository.put: collection='${collectionName}', section='${sectionId}', doc.id='${doc.id}'`);
      sectionMap.set(doc.id, doc);
    }
    return true;
  }

  /**
   * Retrieves a single document from a specific section of a physical vault.
   */
  public async get<T extends RecordBase>(
    collectionName: string,
    docId: string,
    sectionId: string = 'default',
  ): Promise<T | undefined> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section?.get(docId) as T | undefined;
  }

  /**
   * Retrieves all documents from a specific section of a physical vault.
   */
  public async getContainersInSection<T extends RecordBase>(
    collectionName: string,
    sectionId: string,
  ): Promise<T[]> {
    const vault = this.dataVaults.get(collectionName);
    const section = vault?.sections.get(sectionId);
    return section ? (Array.from(section.values()) as T[]) : [];
  }
  
  // ===================================================================================
  // Other IVaultRepository methods... (Simplified or stubbed)
  // ===================================================================================

  public async query<T extends RecordBase>(
    collectionName: string,
    query: { sectionId: string; where: { attribute: string; equals: string }[] },
    ): Promise<T[]> {
      const section = this.dataVaults.get(collectionName)?.sections.get(query.sectionId);
      if (!section) {
        return [];
      }
  
      const allDocs = Array.from(section.values()) as any[];
  
      const filteredDocs = allDocs.filter((doc) => {
        if (!doc.indexed?.attributes) {
          return false;
        }
        return query.where.every((condition) => 
          (doc.indexed.attributes as any[]).some(attr => attr.name === condition.attribute && attr.value === condition.equals)
        );
      });
  
      return filteredDocs as T[];
    }
    
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

  public async getAllSections(collectionName: string): Promise<string[]> {
    const vault = this.dataVaults.get(collectionName);
    return vault ? Array.from(vault.sections.keys()) : [];
  }

  public async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    return this.dataVaults.get(collectionName)?.sections.has(sectionId) ?? false;
  }

  // Stubs for unused methods
  public async updateSection(collectionName: string, sectionId: string, containers: RecordBase[] = []): Promise<boolean> {
    const vault = this.dataVaults.get(collectionName);
    if (!vault) return false;
    const newSection = new Map<string, RecordBase>();
    containers.forEach((doc) => newSection.set(doc.id, doc));
    vault.sections.set(sectionId, newSection);
    return true;
  }
  
  public async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const section = this.dataVaults.get(collectionName)?.sections.get(sectionId);
    return section ? Array.from(section.keys()) : [];
  }

  public async getHistory(collectionName: string, containerId: string): Promise<any[]> {
    console.warn('getHistory is not implemented in VaultMemRepository');
    return [];
  }

  public async delete(collectionName: string, containerId: string, sectionId?: string): Promise<boolean> {
    console.warn('delete is not implemented in VaultMemRepository');
    return false;
  }

  public async purge(collectionName: string): Promise<boolean> {
    console.warn('purge is not implemented in VaultMemRepository');
    return this.dataVaults.delete(collectionName);
  }
}