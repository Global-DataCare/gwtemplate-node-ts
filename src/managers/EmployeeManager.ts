// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { Bundle, BundleEntry, BundleEntryRequest, ErrorEntry } from '../models/bundle';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { ClaimsRecord, RecordBase } from '../models/resource-document';
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ClaimsPersonSchemaorg } from '../models/schemaorg';
import { determineResourceId } from '../utils/resource';
import { EntityConfig } from '../models/entity';
import { initializeEmployeeServices } from '../utils/services';
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { TenantsCacheManager } from './TenantsCacheManager';

const EMPLOYEE_SECTION = 'employees';

export class EmployeeManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;

  constructor(
    vaultRepository: VaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  public async process(job: JobRequest, environment?: string): Promise<IPayloadResponse> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.input?.body?.data ?? [];

    // Fetch the tenant's URN once for the entire job.
    const issuerUrn = this.tenantsCacheManager.getTenantIdentifierUrn(job.tenantId!);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with ID '${job.tenantId}' not found.`, IssueType.NotFound);
    }

    for (const entry of entries) {
      try {
        // Pass the fetched URN down to the entry processor.
        const resultEntry = await this.processEntry(entry, job.tenantId!, issuerUrn, environment);
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const errorEntry = this.handleError(error, entry.type, (entry as BundleEntryRequest).meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    return {
      thid: job.input.thid,
      iss: issuerUrn, // Use the tenant's URN as the issuer
      aud: job.input.aud,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processEntry(
    entry: BundleEntry,
    tenantId: string,
    tenantUrn: string,
    environment?: string,
  ): Promise<BundleEntry> {
    const requestEntry = entry as BundleEntryRequest;
    const { request, meta, type } = requestEntry;
    const claims = meta?.claims;

    if (!request || !claims) {
      throw new ManagerError('Entry requires a request object and meta.claims.', IssueType.Required);
    }

    const identifierClaim = claims[ClaimsPersonSchemaorg.identifier];
    if (!identifierClaim) {
      throw new ManagerError('Missing identifier claim for operation on Employee.', IssueType.Required);
    }
    const employeeId = determineResourceId(identifierClaim, environment);

    switch (request.method) {
      case 'POST':
        return this.createEmployee(tenantId, tenantUrn, employeeId, claims, type);
      case 'DELETE':
        return this.disableEmployee(tenantId, employeeId, type);
      default:
        throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
    }
  }

  private async createEmployee(
    tenantId: string,
    tenantUrn: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
  ): Promise<BundleEntry> {
    await this.kmsService.provisionKeys(employeeId);

    const email = claims[ClaimsPersonSchemaorg.email];
    if (!email || typeof email !== 'string') {
      throw new ManagerError('Missing or invalid email claim.', IssueType.Required);
    }

    const roleCode = claims[ClaimsPersonSchemaorg.hasOccupation];
    if (!roleCode || typeof roleCode !== 'string') {
      throw new ManagerError('Missing or invalid hasOccupation claim.', IssueType.Required);
    }

    // Construct the hierarchical URN using the parent tenant's URN.
    const employeeUrn = `${tenantUrn}:employee:email:${email}:role:isco-08:${roleCode}`;

    const employeeConfig: EntityConfig = {
      id: employeeId,
      type: 'EmployeeConfig',
      status: 'active',
      claims,
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: employeeUrn, // The employee's full, semantic URN
        service: [],
      },
      didConfig: { // didConfig property is required by EntityConfig
        service: []
      },
    };

    // Initialize services using the newly created config
    employeeConfig.didDocument.service = initializeEmployeeServices(employeeConfig);
    
    // Also, update the didConfig with the same services.
    employeeConfig.didConfig.service = employeeConfig.didDocument.service;

    const occupationDoc: RecordBase & { employeeId: string } = {
      id: uuidv4(),
      type: 'Occupation',
      employeeId: employeeId,
      meta: {
        claims: {
          [ClaimsPersonSchemaorg.hasOccupation]: roleCode,
        },
      },
    };

    const docToProtect: ConfidentialStorageDoc = {
      id: employeeConfig.id,
      sequence: 0,
      content: employeeConfig,
    };
    // The tenantId (internal ID) is used for the security context.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantId);
    await this.vaultRepository.put(tenantId, [secureDoc, occupationDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: {
        id: employeeId,
        type: 'Person',
        meta: { claims: claims },
        contained: [occupationDoc],
      },
      response: { status: '201' },
    };
  }

  private async disableEmployee(tenantId: string, employeeId: string, entryType: string): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(tenantId, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, tenantId);
    employee.status = 'disabled';

    const docToProtect: ConfidentialStorageDoc = { ...employeeDoc, content: employee };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantId);
    await this.vaultRepository.put(tenantId, [secureDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: { id: employeeId },
      response: { status: '200' },
    };
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta: meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      console.error('Unexpected error during employee processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.',
          ),
        },
      };
    }
  }
}
