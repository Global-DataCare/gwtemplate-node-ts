// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
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
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntry, ErrorEntry, BundleEntryRequest, Bundle } from '../models/bundle';
import { ClaimsRecord, RecordBase } from '../models/resource-document';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { normalizeCodeSystemAndValue } from '../utils/attributes';
import { ParameterData } from '../models/params';
import { PublicJwk } from '../crypto/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from '../models/did';
import { JobRequest, JobRequestMeta } from '../models/request';

const EMPLOYEE_SECTION = 'employees';

export class EmployeeManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  public async process(job: JobRequest, environment?: string): Promise<IPayloadResponse> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.content?.body?.data ?? [];

    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Job is missing required tenantId or sector.', IssueType.Required);
    }
    const vaultId = getTenantVaultId(job.sector, job.tenantId);

    // Fetch the tenant's URN once for the entire job.
    const issuerUrn = await this.tenantsCacheManager.getTenantIdentifierUrn(vaultId);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with ID '${job.tenantId}' not found.`, IssueType.NotFound);
    }

    if (!job.meta) {
      // This should ideally never happen if the request passed through the security layer.
      throw new ManagerError('Job is missing cryptographic metadata.', IssueType.Invalid);
    }

    for (const entry of entries) {
      try {
        // Pass the fetched URN and the job metadata down to the entry processor.
        const resultEntry = await this.processEntry(entry, vaultId, issuerUrn, job.meta, job.contentType, environment);
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
      thid: job.content.thid,
      iss: issuerUrn, // Use the tenant's URN as the issuer
      aud: job.content.aud,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processEntry(
    entry: BundleEntry,
    vaultId: string,
    tenantUrn: string,
    meta: JobRequestMeta,
    contentType?: string,
    environment?: string,
  ): Promise<BundleEntry> {
    const requestEntry = entry as BundleEntryRequest;
    const { request, meta: entryMeta, type } = requestEntry;
    const claims = entryMeta?.claims;

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
        return this.createEmployee(vaultId, tenantUrn, employeeId, claims, type, meta, contentType);
      case 'DELETE':
        return this.disableEmployee(vaultId, employeeId, type);
      default:
        throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
    }
  }

  private async createEmployee(
    vaultId: string,
    tenantUrn: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
    jobMeta: JobRequestMeta,
    contentType?: string,
  ): Promise<BundleEntry> {
    let signerJwk: PublicJwk | undefined;
    let encrypterJwk: PublicJwk | undefined;

    // The flow for obtaining the employee's public keys depends on the request type.
    if (contentType?.includes('json')) {
      // LEGACY FLOW: The request is unencrypted. The system must provision keys for the new employee.
      // We use the employee's URN as the identifier for the new key set.
      const email = claims[ClaimsPersonSchemaorg.email] as string;
      const roleCode = claims[ClaimsPersonSchemaorg.hasOccupation] as string;
      if (!email || !roleCode) {
        throw new ManagerError('Missing email or hasOccupation claim for legacy employee creation.', IssueType.Required);
      }
      const employeeUrnForKeys = `${tenantUrn}:employee:email:${email}:role:isco-08:${roleCode}`;
      
      const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
      signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
      encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        throw new ManagerError('Failed to provision keys for new employee in legacy flow.', IssueType.Exception);
      }
    } else {
      // SECURE FLOW: The request is encrypted, and the client MUST provide the public keys.
      signerJwk = jobMeta?.jws?.protected?.jwk as PublicJwk;
      encrypterJwk = jobMeta?.jwe?.header?.jwk as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        throw new ManagerError('Missing embedded JWKs in the JWS/JWE headers for employee creation.', IssueType.Required);
      }
    }

    // Additional validation to ensure the keys have kids
    if (!signerJwk.kid || !encrypterJwk.kid) {
      throw new ManagerError('Embedded JWKs must have a "kid" property.', IssueType.Required);
    }

    const email = claims[ClaimsPersonSchemaorg.email];
    if (!email || typeof email !== 'string') {
      throw new ManagerError('Missing or invalid email claim.', IssueType.Required);
    }

    const roleCode = claims[ClaimsPersonSchemaorg.hasOccupation]; // e.g. ISCO-08:<code>
    if (!roleCode || typeof roleCode !== 'string') {
      throw new ManagerError('Missing or invalid hasOccupation claim.', IssueType.Required);
    }

    // Construct the hierarchical URN using the parent tenant's URN.
    const employeeUrn = `${tenantUrn}:employee:email:${email}:role:isco-08:${roleCode}`;

    // Create verification methods from the provided JWKs
    const verificationMethods: VerificationMethod[] = [
      {
        id: `${employeeUrn}#${signerJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: signerJwk as PublicJwk,
      },
      {
        id: `${employeeUrn}#${encrypterJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: encrypterJwk as PublicJwk,
      },
    ];

    const employeeDidDocument: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: employeeUrn,
      verificationMethod: verificationMethods,
      authentication: [verificationMethods[0].id],
      keyAgreement: [verificationMethods[1].id],
      service: [],
    };
    
    // Also add these keys to the parent tenant's DID Document for resolution.
    // This allows others to find the employee's keys by querying the tenant's DID.
    this.tenantsCacheManager.addVerificationMethodToTenant(vaultId, verificationMethods[0]);
    this.tenantsCacheManager.addVerificationMethodToTenant(vaultId, verificationMethods[1]);

    const employeeConfig: EntityConfig = {
      id: employeeId,
      type: 'EmployeeConfig',
      status: 'active',
      claims,
      didDocument: employeeDidDocument,
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

    const attributesToIndex: ParameterData[] = [
      { name: 'email', value: email, unique: true, type: 'string'},
      // The role code is normalized before HMAC to ensure consistent searching.
      { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token'},
      { name: 'kid', value: signerJwk.kid, unique: false, type: 'string'},
      { name: 'kid', value: encrypterJwk.kid, unique: false, type: 'string'},
    ];
    
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, vaultId);

    const docToProtect: ConfidentialStorageDoc = {
      id: employeeConfig.id,
      sequence: 0,
      content: employeeConfig,
      indexed: { attributes: protectedAttributes },
    };
    
    // The tenant's vaultId is used for the security context.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
    await this.vaultRepository.put(vaultId, [secureDoc, occupationDoc], EMPLOYEE_SECTION);

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

  private async disableEmployee(vaultId: string, employeeId: string, entryType: string): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
    employee.status = 'disabled';

    const docToProtect: ConfidentialStorageDoc = { ...employeeDoc, content: employee };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);
    await this.vaultRepository.put(vaultId, [secureDoc], EMPLOYEE_SECTION);

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
