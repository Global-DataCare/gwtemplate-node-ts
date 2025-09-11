// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { getHostDid } from '../utils/did';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { RecordBase } from '../models/resource-document';
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';

const EMPLOYEE_SECTION = 'employees';

export class EmployeeManager {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes an employee data management job and returns a JARM-compliant response payload.
   */
  public async process(job: JobRequest): Promise<IPayloadResponse> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.input?.body?.data ?? [];

    for (const entry of entries) {
      try {
        const resultEntry = await this.processEntry(entry, job.tenantId!);
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const entryType = entry.type || 'Employee-form-unknown-v1.0';
        if (error instanceof ManagerError) {
          responseEntries.push({
            type: entryType,
            response: {
              status: error.status,
              outcome: {
                resourceType: 'OperationOutcome',
                issue: [{ severity: IssueLevel.Error, code: error.code, diagnostics: error.message }],
              },
            },
          });
        } else {
          console.error(`Unexpected error processing employee entry: ${error.message}`);
          responseEntries.push({
            type: entryType,
            response: {
              status: '500',
              outcome: {
                resourceType: 'OperationOutcome',
                issue: [{ severity: IssueLevel.Error, code: IssueType.Exception, diagnostics: 'An unexpected internal error occurred.' }],
              },
            },
          });
        }
      }
    }

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    return {
      thid: job.input.thid,
      iss: getHostDid(),
      aud: job.input.aud,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processEntry(entry: any, tenantId: string): Promise<BundleEntry> {
    const { request, resource, type } = entry;

    if (!request || !resource?.id) {
      throw new ManagerError('Entry requires a request object and a resource with an id.', IssueType.Required);
    }

    if (!tenantId) {
      throw new ManagerError('Tenant context is required to process employee data.', IssueType.Forbidden);
    }
    
    const employeeId = resource.id;

    if (request.method === 'PUT' || request.method === 'POST') {
      await this.vaultRepository.put(tenantId, [resource as RecordBase], EMPLOYEE_SECTION);
      return {
        type: `${type}-receipt`,
        id: employeeId,
        resource: { id: employeeId, resourceType: 'Practitioner' }, // Assuming employee is a Practitioner
        response: { status: '201' },
      };
    } else if (request.method === 'DELETE') {
      await this.vaultRepository.delete(tenantId, employeeId, EMPLOYEE_SECTION);
      return {
        type: `${type}-receipt`,
        id: employeeId,
        resource: { id: employeeId },
        response: { status: '200' },
      };
    }
    
    throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
  }
}
