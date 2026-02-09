// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { determineResourceId } from '../utils/resource';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { initializeEmployeeServices } from '../utils/services';
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { TenantsCacheManager } from './TenantsCacheManager';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntry, ErrorEntry, BundleEntryRequest, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { ClaimsRecord, RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { EntityLifecycleStatus, EntityType } from '../gdc-backend-utils-node/models/enums';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';

const EMPLOYEE_SECTION = getEnvSectionId('employees');
const DEVICE_LICENSE_SECTION = getEnvSectionId('device-licenses');

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

  public async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    
    if (!job.content) {
      throw new ManagerError('Job content is missing', IssueType.Required);
    }
    const entries = job.content.body?.data ?? [];

    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Job is missing required tenantId or sector.', IssueType.Required);
    }
    const vaultId = getTenantVaultId(job.sector, job.tenantId);

    // Fetch the tenant's URN once for the entire job.
    const issuerUrn = await this.tenantsCacheManager.getTenantIdentifierUrn(vaultId);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with ID '${job.tenantId}' not found.`, IssueType.NotFound);
    }

    if (!job.content.meta) {
      // This should ideally never happen if the request passed through the security layer.
      throw new ManagerError('Job is missing cryptographic metadata.', IssueType.Invalid);
    }

    for (const entry of entries) {
      try {
        // Pass the fetched URN and the job metadata down to the entry processor.
        const resultEntry = await this.processEntry(
          entry,
          vaultId,
          issuerUrn,
          job.content.meta,
          job.contentType,
          environment,
          job.sector,
          job.jurisdiction,
        );
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const errorEntry = this.handleError(error, entry.type, (entry as BundleEntryRequest).meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      total: responseEntries.length,
      type: getBundleResponseTypeForAction(job.action),
    };

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      thid: job.content.thid as string,
      iss: issuerUrn, // Use the tenant's URN as the issuer
      aud: job.content.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'batch-response',
      body: responseBundle,
    };
    return result;
  }

  private async processEntry(
    entry: BundleEntry,
    vaultId: string,
    tenantUrn: string,
    meta: IDecodedDidcommPayload['meta'],
    contentType?: string,
    environment?: string,
    sector?: string,
    jurisdiction?: string,
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
        return this.createEmployee(vaultId, tenantUrn, employeeId, claims, type, meta, contentType, sector, jurisdiction);
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
    jobMeta: IDecodedDidcommPayload['meta'],
    contentType?: string,
    sector?: string,
    jurisdiction?: string,
  ): Promise<BundleEntry> {
    let signerJwk: PublicJwk | undefined;
    let encrypterJwk: PublicJwk | undefined;

    const email = claims[ClaimsPersonSchemaorg.email];
    if (!email || typeof email !== 'string') {
      throw new ManagerError('Missing or invalid email claim.', IssueType.Required);
    }

    const roleCode = claims[ClaimsPersonSchemaorg.hasOccupation] as string; // e.g. ISCO-08|<code>
    if (!roleCode) {
      throw new ManagerError('Missing or invalid hasOccupation claim.', IssueType.Required);
    }

    const employeeUrnForKeys = `${tenantUrn}:employee:${email}:role:isco-08|${roleCode}`;

    const licenseOffer = await this.tryConsumeEmployeeSeatOrOffer({
      vaultId,
      employeeId,
      sector: sector || 'health-care',
      jurisdiction: jurisdiction || 'us',
    });
    if (licenseOffer) return licenseOffer;

    // The flow for obtaining the employee's public keys depends on the request type.
    if (contentType?.includes('json')) {
      // LEGACY FLOW: The request is unencrypted. The system must provision keys for the new employee.
      // We use the employee's URN as the identifier for the new key set.
      const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
      signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
      encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        throw new ManagerError('Failed to provision keys for new employee in legacy flow.', IssueType.Exception);
      }
    } else {
      // SECURE FLOW: The request is encrypted.
      // If the client provides embedded JWKs, use them; otherwise provision keys server-side.
      signerJwk = jobMeta?.jws?.protected?.jwk as PublicJwk;
      encrypterJwk = jobMeta?.jwe?.header?.jwk as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
        signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
        encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;
      }
    }

    // Additional validation to ensure the keys have kids
    if (!signerJwk.kid || !encrypterJwk.kid) {
      throw new ManagerError('Embedded JWKs must have a "kid" property.', IssueType.Required);
    }

    // Construct the hierarchical URN using the parent tenant's URN.
    const employeeUrn = `${tenantUrn}:employee:${email}:role:isco-08|${roleCode}`;

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
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims,
      didDocument: employeeDidDocument,
      didConfig: { // didConfig property is required by EntityConfig
        service: []
      },
      meta: {
        lastUpdated: new Date().toISOString(),
      },
    };

    const tenantClaims = await this.tenantsCacheManager.getEntityClaims(vaultId);
    if (!tenantClaims) {
      throw new ManagerError(`Could not retrieve claims for tenant vault ${vaultId}`, IssueType.NotFound);
    }
    
    // Initialize services using the tenant's service claims and the new employee config.
    employeeConfig.didDocument!.service = initializeEmployeeServices(employeeConfig, tenantClaims);
    
    // Also, update the didConfig with the same services.
    employeeConfig.didConfig!.service = employeeConfig.didDocument!.service;

    const occupationDoc: IncludedResource & { employeeId: string } = {
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
      status: employeeConfig.status,
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

  private async tryConsumeEmployeeSeatOrOffer(params: {
    vaultId: string;
    employeeId: string;
    sector: string;
    jurisdiction: string;
  }): Promise<BundleEntry | undefined> {
    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
        params.vaultId,
        DEVICE_LICENSE_SECTION,
      )) || [];

    const employeeLicenseDocs = licenseDocs.filter((doc) => (doc.content as DeviceLicense | undefined)?.userClass === 'employee');
    if (employeeLicenseDocs.length === 0) {
      // No employee licenses in the vault => licensing not configured; do not gate.
      return undefined;
    }

    const availableDoc = employeeLicenseDocs.find((doc) => (doc.content as DeviceLicense).status === 'available');
    if (!availableDoc) {
      const hostDid = (await this.tenantsCacheManager.getTenantDid('host')) || 'did:web:host';
      const allowedPaymentMethods = (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(',').map(s => s.trim()).filter(Boolean);
      const offerClaims = generateLicenseOffer(
        1,
        hostDid,
        params.jurisdiction,
        params.sector,
        allowedPaymentMethods,
        'employee',
      );

      return {
        type: 'Employee-license-offer-v1.0',
        meta: { claims: offerClaims },
        response: { status: '200' },
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const updatedLicense: DeviceLicense = {
      ...(availableDoc.content as DeviceLicense),
      status: 'issued',
      subjectId: params.employeeId,
      issuedAt: nowSec,
    };
    await this.vaultRepository.put(
      params.vaultId,
      [{ ...availableDoc, content: updatedLicense }],
      DEVICE_LICENSE_SECTION,
    );
    return undefined;
  }

  private async disableEmployee(vaultId: string, employeeId: string, entryType: string): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(vaultId, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);
    employee.status = EntityLifecycleStatus.Inactive;

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
