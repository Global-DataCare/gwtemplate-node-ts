// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Bundle, BundleEntry } from '@/models/bundle';
import { ManagerResult } from '@/models/manager-result';
import { VaultRepository } from '@/database/repositories/vault/vault.repository';
import { RecordBase } from '@/models/resource-document';
import { addEntryToResult } from '@/utils/bundle';

const EMPLOYEE_SECTION = 'employees';

export class EmployeeManager {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes a bundle and returns a format-agnostic result.
   * It does NOT build the final response bundle.
   */
  public async processBundle(tenantId: string, bundle: Bundle): Promise<ManagerResult> {
    let result: ManagerResult = { entries: [] };

    for (const entry of bundle.data) {
      const { request, resource } = entry;
      const employeeId = resource?.id || 'unknown';

      try {
        if (!request || !resource?.id) {
          throw new Error('Bundle entry must have a request object and a resource with an id.');
        }

        if (request.method === 'PUT' || request.method === 'POST') {
          await this.vaultRepository.put(tenantId, [resource as RecordBase], EMPLOYEE_SECTION);
          const successEntry: BundleEntry = {
            resource: { id: employeeId, resourceType: 'Practitioner' },
            response: { status: '201' }
          };
          result = addEntryToResult(result, successEntry);
        } else if (request.method === 'DELETE') {
          await this.vaultRepository.delete(tenantId, employeeId, EMPLOYEE_SECTION);
          const successEntry: BundleEntry = {
            resource: { id: employeeId },
            response: { status: '200' }
          };
          result = addEntryToResult(result, successEntry);
        }
      } catch (error: any) {
        const errorEntry: BundleEntry = {
          resource: { id: employeeId },
          response: {
            status: '400',
            outcome: { issue: [{ details: { text: error.message } }] }
          }
        };
        result = addEntryToResult(result, errorEntry);
      }
    }
    return result;
  }
}
