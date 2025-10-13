// src/managers/CustomerManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { getBundleResponseTypeForAction } from '../utils/bundle';
import { Bundle, BundleEntry, BundleEntryRequest, ErrorEntry } from '../models/bundle';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { EntityConfig } from '../models/entity';
import { initializeCustomerServices } from '../utils/services'; 
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { ParameterData } from '../models/params'; // extends ParamAttribute with `type` and others
import { CredentialManager } from './CredentialManager';
import { TenantsCacheManager } from './TenantsCacheManager';
import { parseTenantUrn } from '../utils/urn';
import { Sector } from '../models/path';
import { determineResourceId } from '../utils/resource';
import { uuidToBytes } from '../utils/uuid';
import { encodeMultibase58btc } from '../utils/multibase58';
import { IncludedResource } from '../models/jsonapi';
import { ClaimsRecord } from '../models/resource-document';

const CUSTOMER_SECTION = 'customers';

export class CustomerManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private credentialManager: CredentialManager;

  constructor(
    vaultRepository: VaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    credentialManager: CredentialManager,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.credentialManager = credentialManager;
  }

  public async process(job: JobRequest, environment?: string): Promise<IPayloadResponse> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.input?.body?.data ?? [];
    const tenantVaultId = job.tenantId!; // In this context, job.tenantId is the vaultId.

    const issuerUrn = await this.tenantsCacheManager.getTenantUrn(tenantVaultId);
    if (!issuerUrn) {
      // This is a catastrophic failure for the whole batch, as we don't know who the issuer is.
      throw new ManagerError(`Tenant with ID '${tenantVaultId}' not found.`, IssueType.NotFound);
    }

    // Process each entry individually to support true batch operations.
    for (const entry of entries) {
      try {
        // Assuming all entries in this batch are for creation, based on the job type.
        // A more complex manager might inspect entry.request.method.
        const resultEntry = await this._processSingleCreation(entry, tenantVaultId, issuerUrn, environment);
        responseEntries.push(resultEntry);
      } catch (error: any) {
        // If a single entry fails, create an error entry for it and continue with the next.
        const errorEntry = this.handleError(error, entry.type, entry.meta);
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
      iss: issuerUrn,
      aud: job.input.aud,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async _processSingleCreation(
    entry: BundleEntryRequest,
    tenantVaultId: string,
    tenantUrn: string,
    environment?: string,
  ): Promise<BundleEntry> {
    const originalClaims = entry.meta?.claims;
    if (!originalClaims) {
      throw new ManagerError('Missing meta.claims in batch entry.', IssueType.Required);
    }

    // 1. Extract resources from claims, following the HostingManager pattern.
    const { person, service } = this._extractResources(originalClaims, environment);

    const publicIdentifierClaim = person.meta.claims[ClaimsPersonSchemaorg.identifier] as string;
    const internalId = person.id; // Already determined by _extractResources

    // 2. Prepare data for indexing (excluding sensitive PII like birthDate).
    const parametersToIndex = this._buildIndexParameters(person.meta.claims);
    const indexedAttributes = await this.kmsService.protectAttributesNameAndValue(parametersToIndex, tenantVaultId);

    // 3. Construct the final, canonical identifiers and EntityConfig.
    const multibaseId = encodeMultibase58btc(uuidToBytes(internalId));
    const customerUrn = `${tenantUrn}:individual:multibase:${multibaseId}`;
    
    // Ensure the final claims reflect the canonical URN.
    person.meta.claims[ClaimsPersonSchemaorg.identifier] = customerUrn;

    const customerConfig: EntityConfig = {
      id: internalId,
      type: 'CustomerConfig',
      status: 'active',
      claims: person.meta.claims, // Store all person-related claims.
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: customerUrn,
        service: [],
      },
      didConfig: { service: [] },
    };

    const parsedUrn = parseTenantUrn(tenantUrn);
    const sector = parsedUrn!.sector as Sector;
    customerConfig.didDocument.service = initializeCustomerServices(customerConfig, sector);
    customerConfig.didConfig.service = customerConfig.didDocument.service;

    // 4. Construct and persist the secure document.
    const docToStore: ConfidentialStorageDoc = {
      id: internalId,
      sequence: 0,
      indexed: { attributes: indexedAttributes },
      content: customerConfig,
    };
    const protectedDoc = await this.kmsService.protectConfidentialData(docToStore, tenantVaultId);
    await this.vaultRepository.put(tenantVaultId, [protectedDoc], CUSTOMER_SECTION);

    // 5. Build the structured API response.
    return {
      type: 'Customer',
      resource: {
        ...person, // Includes id, type, and meta.claims
        resourceType: 'Person',
        contained: [
          { ...service, resourceType: 'Service' }
        ],
      },
      response: { status: '201' },
    };
  }

  /**
   * Builds a list of parameters for indexing from the person claims.
   */
  private _buildIndexParameters(claims: ClaimsRecord): ParameterData[] {
    const parameters: ParameterData[] = [];
    for (const [key, value] of Object.entries(claims)) {
      if (key !== ClaimsPersonSchemaorg.birthDate) { // Exclude sensitive PII
        if (typeof value === 'object' && value !== null && 'additionalType' in value && 'value' in value) {
          const val = value as any;
          parameters.push({ name: val.additionalType, value: val.value, unique: true, type: 'token' });
        } else {
          parameters.push({ name: key, value: value as string, type: 'string' });
        }
      }
    }
    return parameters;
  }

  /**
   * Extracts and builds Person and Service resources from a flat claims object.
   * This is a direct adaptation of the pattern used in HostingManager.
   */
  private _extractResources(claims: ClaimsRecord, environment?: string) {
    const resources: Record<string, any> = {};

    // Define the resource types to be extracted for a Customer creation
    const resourceTypes = ['Person', 'Service'];

    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = {};
      let claimFound = false;

      for (const key in claims) {
        if (key.startsWith(`org.schema.${type}.`)) {
          resourceClaims[key] = claims[key];
          claimFound = true;
        }
      }

      if (claimFound) {
        const identifierClaim = resourceClaims[`org.schema.${type}.identifier`];
        const resourceId = determineResourceId(identifierClaim, environment);
        
        // Ensure the identifier claim is always a canonical URN.
        resourceClaims[`org.schema.${type}.identifier`] = `urn:uuid:${resourceId}`;
        
        resources[type.toLowerCase()] = {
          id: resourceId,
          type: type,
          meta: { claims: resourceClaims },
        };
      }
    }
    if (!resources.person || !resources.service) {
      throw new ManagerError(
        'Incomplete claims: Person and Service resources are required for customer creation.',
        IssueType.Required,
      );
    }
    return resources as { person: IncludedResource; service: IncludedResource };
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
      console.error('Unexpected error during customer processing:', error);
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
