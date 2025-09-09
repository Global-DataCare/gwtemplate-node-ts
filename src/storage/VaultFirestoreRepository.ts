// src/storage/VaultFirestoreRepository.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Firestore, FieldValue } from '@google-cloud/firestore';
import { VaultRepository } from '@/database/repositories/vault/vault.repository';
import { VaultConfig, RecordBase } from '@/models/resource-document';

/**
 * A Firestore-based implementation of the Vault Repository.
 *
 * It models the abstract concepts of Vaults and Sections using Firestore's
 * collections and sub-collections.
 *
 * - A Vault is a top-level document in a `vaults` collection.
 * - A Section is a document in a `sections` sub-collection within a vault document.
 * - Records are stored in an array called `records` within each section document.
 */
export class VaultFirestoreRepository implements VaultRepository {
  private firestore: Firestore;
  private vaultsCollection = 'vaults';
  private sectionsSubCollection = 'sections';

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    if (!vaultConfig || !vaultConfig.id) return false;
    const vaultRef = this.firestore.collection(this.vaultsCollection).doc(vaultConfig.id);
    await vaultRef.set(vaultConfig);
    return true;
  }

  async vaultExists(vaultId: string): Promise<boolean> {
    const vaultRef = this.firestore.collection(this.vaultsCollection).doc(vaultId);
    return (await vaultRef.get()).exists;
  }

  async getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    const vaultRef = this.firestore.collection(this.vaultsCollection).doc(vaultId);
    const doc = await vaultRef.get();
    return doc.exists ? (doc.data() as VaultConfig) : undefined;
  }

  async createNewSection(vaultId: string, sectionId: string): Promise<boolean> {
    const sectionRef = this.firestore
      .collection(this.vaultsCollection)
      .doc(vaultId)
      .collection(this.sectionsSubCollection)
      .doc(sectionId);
    await sectionRef.set({ records: [] }); // Initialize with an empty records array
    return true;
  }

  async sectionExists(vaultId: string, sectionId: string): Promise<boolean> {
    const sectionRef = this.firestore.collection(this.vaultsCollection).doc(vaultId).collection(this.sectionsSubCollection).doc(sectionId);
    return (await sectionRef.get()).exists;
  }

  async put<T extends RecordBase>(vaultId: string, containers: T[], sectionId = 'default'): Promise<boolean> {
    if (!containers || containers.length === 0) return false;

    if (!(await this.sectionExists(vaultId, sectionId))) {
      await this.createNewSection(vaultId, sectionId);
    }
    const sectionRef = this.firestore.collection(this.vaultsCollection).doc(vaultId).collection(this.sectionsSubCollection).doc(sectionId);

    // Firestore's arrayUnion provides a way to add elements to an array without reading the doc first.
    // For simplicity here, we add them one by one. A transaction or batch write would be better for production.
    for (const record of containers) {
      await sectionRef.update({
        records: FieldValue.arrayUnion(record)
      });
    }
    return true;
  }

  async get<T extends RecordBase>(vaultId: string, containerId: string, sectionId = 'default'): Promise<T | undefined> {
    const sectionRef = this.firestore.collection(this.vaultsCollection).doc(vaultId).collection(this.sectionsSubCollection).doc(sectionId);
    const doc = await sectionRef.get();
    if (!doc.exists) {
      return undefined;
    }
    const records = doc.data()?.records || [];
    return records.find((rec: RecordBase) => rec.id === containerId) as T | undefined;
  }


  async getContainersInSection<T extends RecordBase>(vaultId: string, sectionId: string): Promise<T[]> {
    const sectionRef = this.firestore.collection(this.vaultsCollection).doc(vaultId).collection(this.sectionsSubCollection).doc(sectionId);
    const doc = await sectionRef.get();

    return doc.exists ? (doc.data()?.records as T[] || []) : [];
  }

  // --- Other required methods from the abstract class ---

  public async updateSection(vaultId: string, sectionId: string, containers?: any[]): Promise<boolean> {
    console.warn("updateSection is deprecated, use put()");
    return this.put(vaultId, containers || [], sectionId);
  }

  public async getAllSections(vaultId: string): Promise<string[]> {
    const sectionsRef = this.firestore.collection(this.vaultsCollection).doc(vaultId).collection(this.sectionsSubCollection);
    const snapshot = await sectionsRef.get();
    return snapshot.docs.map(doc => doc.id);
  }

  public async getContainersListInSection(vaultId: string, sectionId: string): Promise<string[]> {
    const records = await this.getContainersInSection(vaultId, sectionId);
    return records.map(r => r.id);
  }


  public async getHistory(vaultId: string, containerId: string): Promise<any[]> { throw new Error('Not implemented for Firestore adapter.'); }
  public async query(vaultId: string, query: any): Promise<any[]> { throw new Error('Not implemented for Firestore adapter.'); }
  public async delete(vaultId: string, containerId: string, sectionId?: string): Promise<boolean> { throw new Error('Not implemented for Firestore adapter.'); }
  public async purge(vaultId: string): Promise<boolean> { throw new Error('Not implemented for Firestore adapter.'); }
}
