// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/database/repositories/vault/vault.repository.ts

import { RecordBase, VaultConfig } from "../../../models/resource-document";

/**
 * Defines the contract for a Vault Repository, based on the original DatabaseAbstract.
 * This interface is agnostic to the underlying storage technology.
 * The concepts of 'vaults' (tenants) and 'sections' (data partitions) are used to organize data.
 */
export abstract class IVaultRepository {
    /** Creates a new vault (e.g., for a new tenant). */
    abstract createNewVault(vaultConfig: VaultConfig): Promise<boolean>;
    /** Checks if a vault exists. */
    abstract vaultExists(vaultId: string): Promise<boolean>;
    /** Retrieves the configuration for a specific vault. */
    abstract getVaultConfig(vaultId: string): Promise<VaultConfig | undefined>;
    /** Creates a new section within a vault. */
    abstract createNewSection(vaultId: string, sectionId: string): Promise<boolean>;
    /** Updates or creates a section with the provided records. */
    abstract updateSection(vaultId: string, sectionId: string, containers?: any[]): Promise<boolean>;
    /** Retrieves all section IDs from a vault. */
    abstract getAllSections(vaultId: string): Promise<string[]>;
    /** Checks if a section exists within a vault. */
    abstract sectionExists(vaultId: string, sectionId: string): Promise<boolean>;
    /** Retrieves a list of record identifiers from a section. */
    abstract getContainersListInSection(vaultId: string, sectionId: string): Promise<string[]>;
    /** Retrieves full records from a section. */
    abstract getContainersInSection<T extends RecordBase>(vaultId: string, sectionId: string, excludeRecordTypes?: string[]): Promise<T[]>;
    /** Writes one or more records. */
    abstract put<T extends RecordBase>(vaultId: string, containers: T[], sectionId?: string): Promise<boolean>;
    /** Reads a single record by its ID (latest version). */
    abstract get<T extends RecordBase>(vaultId: string, containerId: string, sectionId?: string): Promise<T | undefined>;
    /** Retrieves all versions of a record by its ID. */
    abstract getHistory(vaultId: string, containerId: string): Promise<any[]>;
    /** Queries for records based on a structured query object. */
    abstract query(vaultId: string, query: any): Promise<any[]>;
    /** Marks a record as deleted. */
    abstract delete(vaultId: string, containerId: string, sectionId?: string): Promise<boolean>;
    /** Permanently removes records marked as deleted. */
    abstract purge(vaultId: string): Promise<boolean>;
}
