// src/managers/CustomerManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { RecordBase } from '../models/resource-document';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { composeHostDidWebId } from '../utils/did';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { IJobProcessor } from './registry';

const CUSTOMER_PROFILE_SECTION = 'profile';

export class CustomerManager implements IJobProcessor {
  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes a customer data management job and returns a JARM-compliant response payload.
   */
  public async process(job: JobRequest): Promise<IPayloadResponse> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.input?.body?.data ?? [];

    for (const entry of entries) {
      try {
        const resultEntry = await this.processEntry(entry, job.tenantId!);
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const entryType = entry.type || 'Customer-form-unknown-v1.0';
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
          console.error(`Unexpected error processing customer entry: ${error.message}`);
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
      iss: composeHostDidWebId(),
      aud: job.input.aud,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processEntry(entry: any, custodianTenantId: string): Promise<BundleEntry> {
    const { request, resource, type } = entry;

    if (!request || !resource?.id) {
      throw new ManagerError('Entry requires a request object and a resource with an id.', IssueType.Required);
    }

    if (!custodianTenantId) {
      throw new ManagerError('Tenant context (custodian) is required to process customer data.', IssueType.Forbidden);
    }
    
    const vaultId = resource.id;

    if (request.method === 'PUT' || request.method === 'POST') {
      const vaultExists = await this.vaultRepository.vaultExists(vaultId);
      if (!vaultExists) {
        await this.vaultRepository.createNewVault({ id: vaultId, custodian: custodianTenantId });
      }
      await this.vaultRepository.put(vaultId, [resource as RecordBase], CUSTOMER_PROFILE_SECTION);

      return {
        type: `${type}-receipt`,
        id: resource.id,
        resource: { id: resource.id, resourceType: resource.resourceType },
        response: { status: vaultExists ? '200' : '201' },
      };
    }
    
    throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
  }
}
