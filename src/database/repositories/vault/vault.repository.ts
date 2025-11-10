// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.repository.ts

import { RecordBase, VaultConfig } from "../../../models/resource-document";

/**
 * Defines the contract for a Vault Repository.
 *
 * @architecture
 * This interface represents the lowest level of the storage abstraction layer. It is
 * intentionally "dumb" and operates on physical identifiers (`collectionName`) rather than
 * logical business identifiers (`vaultId`). The responsibility of translating logical IDs
 * to physical ones lies with the `TenantsCacheManager`.
 *
 * Methods like `createNewVault` and `vaultExists` are exceptions; they operate on logical
 * `vaultId`s because their scope is the logical existence of a vault, which in the
 * Firestore implementation is managed via a separate metadata collection.
 */
export abstract class IVaultRepository {
    /** Creates a new vault's metadata entry. Operates on a logical vaultId. */
    abstract createNewVault(vaultConfig: VaultConfig): Promise<boolean>;
    /** Checks if a vault's metadata entry exists. Operates on a logical vaultId. */
    abstract vaultExists(vaultId: string): Promise<boolean>;
    /** Retrieves the configuration for a specific vault. */
    abstract getVaultConfig(vaultId: string): Promise<VaultConfig | undefined>;
    /** Creates a new section within a vault. */
    abstract createNewSection(collectionName: string, sectionId: string): Promise<boolean>;
    /** Updates or creates a section with the provided records. */
    abstract updateSection(collectionName: string, sectionId: string, containers?: any[]): Promise<boolean>;
    /** Retrieves all section IDs from a vault. */
    abstract getAllSections(collectionName: string): Promise<string[]>;
    /** Checks if a section exists within a vault. */
    abstract sectionExists(collectionName: string, sectionId: string): Promise<boolean>;
    /** Retrieves a list of record identifiers from a section. */
    abstract getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]>;
    /** Retrieves full records from a section. */
    abstract getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string, excludeRecordTypes?: string[]): Promise<T[]>;
    /** Writes one or more records. */
    abstract put<T extends RecordBase>(collectionName: string, containers: T[], sectionId?: string): Promise<boolean>;
    /** Reads a single record by its ID (latest version). */
    abstract get<T extends RecordBase>(collectionName: string, containerId: string, sectionId?: string): Promise<T | undefined>;
    /** Retrieves all versions of a record by its ID. */
    abstract getHistory(collectionName: string, containerId: string): Promise<any[]>;
    /** Queries for records based on a structured query object. */
    abstract query(collectionName: string, query: any): Promise<any[]>;
    /** Marks a record as deleted. */
    abstract delete(collectionName: string, containerId: string, sectionId?: string): Promise<boolean>;
    /** Permanently removes records marked as deleted. */
    abstract purge(collectionName: string): Promise<boolean>;
}
