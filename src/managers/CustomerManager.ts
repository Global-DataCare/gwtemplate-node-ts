// src/managers/CustomerManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VaultRepository } from '@/database/repositories/vault/vault.repository';
import { RecordBase } from '@/models/resource-document';
import { Bundle, BundleEntry } from '@/models/bundle';
import { ManagerResult } from '@/models/manager-result';
import { addEntryToResult } from '@/utils/bundle';

const CUSTOMER_PROFILE_SECTION = 'profile';

export class CustomerManager {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes a bundle and returns a format-agnostic result.
   */
  public async processBundle(bundle: Bundle, custodianTenantId: string): Promise<ManagerResult> {
    // Initialize with a single, ordered list of entries
    let result: ManagerResult = { entries: [] };
    const entries = bundle.data ?? [];

    for (const entry of entries) {
      const { request, resource } = entry;
      const customerId = resource?.id || 'unknown';

      try {
        if (!request || !resource?.id) {
          throw new Error('Bundle entry must have a request object and a resource with an id.');
        }

        const vaultId = resource.id;

        if (request.method === 'PUT' || request.method === 'POST') {
          const vaultExists = await this.vaultRepository.vaultExists(vaultId);
          if (!vaultExists) {
            await this.vaultRepository.createNewVault({ id: vaultId, custodian: custodianTenantId });
          }
          await this.vaultRepository.put(vaultId, [resource as RecordBase], CUSTOMER_PROFILE_SECTION);

          // Create and add a success entry
          const successEntry: BundleEntry = {
            resource: { id: resource.id, resourceType: resource.resourceType },
            response: { status: '201' } // STATUS CODE ONLY
          };
          result = addEntryToResult(result, successEntry);
        }

      } catch (error: any) {
        // Create and add an error entry
        const errorEntry: BundleEntry = {
          resource: { id: customerId },
          response: { 
            status: '400', // STATUS CODE ONLY
            outcome: { issue: [{ details: { text: error.message } }] }
          }
        };
        result = addEntryToResult(result, errorEntry);
      }
    }
    return result;
  }
}
