// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.mem.repository.ts

import { VaultRepository } from './vault.repository';
import { RecordBase, VaultConfig } from '../../../models/resource-document';
import { InMemoryVault } from '../../../models/repository';

/**
 * An in-memory implementation of the Vault Repository.
 * Useful for testing and development environments.
 */
export class VaultMemRepository implements VaultRepository {
  private vaults = new Map<string, InMemoryVault>();

  /**
   * Clears all vaults and sections from the in-memory store.
   * This is useful for ensuring a clean state between test runs.
   */
  public clear(): void {
    this.vaults.clear();
  }  

  public async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    console.log(`[VaultMemRepository] Attempting to create new vault with id: '${vaultConfig.id}'`);
    if (this.vaults.has(vaultConfig.id)) {
      console.error(`[VaultMemRepository] Vault creation failed, vault already exists: '${vaultConfig.id}'`);
      return false;
    }
    this.vaults.set(vaultConfig.id, {
      config: vaultConfig,
      sections: new Map(),
    });
    return true;
  }

  public async vaultExists(vaultId: string): Promise<boolean> {
    return this.vaults.has(vaultId);
  }
  
  public async getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    return this.vaults.get(vaultId)?.config;
  }

  public async createNewSection(vaultId: string, sectionId: string): Promise<boolean> {
    const vault = this.vaults.get(vaultId);
    if (!vault || vault.sections.has(sectionId)) {
      return false;
    }
    vault.sections.set(sectionId, new Map());
    return true;
  }
  
  public async updateSection(vaultId: string, sectionId: string, containers: RecordBase[] = []): Promise<boolean> {
    const vault = this.vaults.get(vaultId);
    if (!vault) {
      return false;
    }
    const newSection = new Map<string, RecordBase>();
    containers.forEach(doc => newSection.set(doc.id, doc));
    vault.sections.set(sectionId, newSection);
    return true;
  }

  public async getAllSections(vaultId: string): Promise<string[]> {
    const vault = this.vaults.get(vaultId);
    return vault ? Array.from(vault.sections.keys()) : [];
  }

  public async sectionExists(vaultId: string, sectionId: string): Promise<boolean> {
    return this.vaults.get(vaultId)?.sections.has(sectionId) ?? false;
  }

  public async getContainersListInSection(vaultId: string, sectionId: string): Promise<string[]> {
    const section = this.vaults.get(vaultId)?.sections.get(sectionId);
    return section ? Array.from(section.keys()) : [];
  }
  
  public async getContainersInSection<T extends RecordBase>(vaultId: string, sectionId: string): Promise<T[]> {
    const section = this.vaults.get(vaultId)?.sections.get(sectionId);
    return section ? Array.from(section.values()) as T[] : [];
  }

  public async put<T extends RecordBase>(vaultId: string, containers: T[], sectionId: string = 'default'): Promise<boolean> {
    console.log(`[VaultMemRepository] Putting ${containers.length} container(s) into vault: '${vaultId}', section: '${sectionId}'`);
    const vault = this.vaults.get(vaultId);
    if (!vault) {
      console.error(`[VaultMemRepository] Cannot put data, vault not found: '${vaultId}'`);
      return false;
    }

    // Ensure the section exists before trying to add to it.
    if (!vault.sections.has(sectionId)) {
      vault.sections.set(sectionId, new Map<string, RecordBase>());
    }
    
    // Get a DIRECT REFERENCE to the section map.
    const sectionMap = vault.sections.get(sectionId)!;
    
    for (const doc of containers) {
      if (!doc.id) {
        throw new Error('Document must have an id.');
      }
      // Modify the original map directly through the reference.
      sectionMap.set(doc.id, doc);
    }
    return true;
  }

  public async get<T extends RecordBase>(vaultId: string, containerId: string, sectionId: string = 'default'): Promise<T | undefined> {
    const section = this.vaults.get(vaultId)?.sections.get(sectionId);
    return section?.get(containerId) as T | undefined;
  }

  // Mock implementations for methods not strictly required by the test,
  // but needed to satisfy the interface.
  public async getHistory(vaultId: string, containerId: string): Promise<any[]> {
    console.warn("getHistory is not implemented in VaultMemRepository");
    return [];
  }

  public async query(vaultId: string, query: any): Promise<any[]> {
    console.warn("query is not implemented in VaultMemRepository");
    return [];
  }

  public async delete(vaultId: string, containerId: string, sectionId?: string): Promise<boolean> {
    console.warn("delete is not implemented in VaultMemRepository");
    return false;
  }

  public async purge(vaultId: string): Promise<boolean> {
    console.warn("purge is not implemented in VaultMemRepository");
    return false;
  }
}

