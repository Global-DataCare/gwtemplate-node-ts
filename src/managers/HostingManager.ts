// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts

import { IServerConfig } from '../config';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { DidDocument } from '../models/did';
import { EntityConfig } from '../models/entity';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { IncludedResource } from '../models/jsonapi';
import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { ClaimsRecord } from '../models/resource-document';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { Sector } from '../models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { validateNewOrganizationClaims } from '../utils/claims-validator';
import { composeHostDidWebId, createHostedDidWeb, populateDidDocumentFromJwks } from '../utils/did';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { initializeHostServices, initializeTenantServices } from '../utils/services';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { AllowedIndexableClaims } from '../models/indexing';
import { createOrganizationUrn } from '../utils/urn';
import { TenantsCacheManager } from './TenantsCacheManager';

/**
 * Manages the business logic for HOSTING, including new tenant registration.
 */
export class HostingManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private storageAdapter: IStorageAdapter;
  private config: IServerConfig;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    storageAdapter: IStorageAdapter,
    config: IServerConfig,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.storageAdapter = storageAdapter;
    this.config = config;
  }

  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    const { organization, person, service } = this.extractResources(hostClaims);
    const processedService = await this._handleServiceAttachment(service);
    const allClaims = { ...hostClaims, ...(processedService?.meta.claims || {}) };
    await this.persistHostConfig(organization, allClaims, [person, processedService!]);
  }

  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IPayloadResponse> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processRegistrationEntry(entry, environment);
        responseEntries.push(resultEntry);
      } catch (error) {
        if (isBootstrap) {
          throw error;
        }
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      thid: job.content.thid,
      iss: issuerDid,
      aud: job.content.iss,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processRegistrationEntry(entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const claims = entry?.meta?.claims;
    const entryType = entry.type || 'Organization-unknown';

    if (!claims) {
      return this.handleError(new ManagerError('Malformed entry: missing meta.claims', IssueType.Required), entryType, entry.meta);
    }

    try {
      validateNewOrganizationClaims(claims);
      const alternateName = claims[ClaimsOrganizationSchemaorg.alternateName] as string;

      if (!alternateName) {
        throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
      }

      let validatedSector: Sector | undefined;

      if (alternateName !== 'host') {
        if (!isValidTenantAlternateName(alternateName)) {
          throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
        }

        const requestedSector = claims[ClaimsServiceSchemaorg.category] as Sector;
        if (!requestedSector) {
          throw new ManagerError(`Missing required claim for new tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
        }
        if (requestedSector === Sector.SYSTEM) {
          throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
        }
        if (!this.config.sectorsAllowed.includes(requestedSector)) {
          throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
        }
        validatedSector = requestedSector;

        const vaultId = getTenantVaultId(validatedSector, alternateName);
        if (await this.vaultRepository.vaultExists(vaultId)) {
          throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
        }
      }

      const { organization, person, service } = this.extractResources(claims, environment);
      const processedService = await this._handleServiceAttachment(service);
      const processedClaims = { ...claims, ...(processedService?.meta.claims || {}) };

      if (alternateName === 'host') {
        await this.persistHostConfig(organization, processedClaims, [person, processedService!]);
      } else {
        await this.persistTenantConfig(organization, alternateName, processedClaims, [person, processedService!], validatedSector!);
      }

      return {
        type: entryType,
        resource: {
          resourceType: 'Organization',
          id: organization.id,
          meta: organization.meta,
          contained: [person, processedService],
        },
        response: { status: '201' },
      };
    } catch (error: any) {
      return this.handleError(error, entryType, entry.meta);
    }
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
      console.error('Unexpected error during registration processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
        },
      };
    }
  }

  private async persistHostConfig(org: IncludedResource, allClaims: ClaimsRecord, contained: IncludedResource[]) {
    const hostCollectionName = generateTenantCollectionNameFromClaims(allClaims);
    const logicalVaultId = 'host';

    await this.vaultRepository.createNewVault({ id: hostCollectionName });
    await this.kmsService.provisionKeys(logicalVaultId);
    
    const publicKeys = await this.kmsService.getPublicJwks(logicalVaultId);

    const hostConfig: EntityConfig = {
      type: org.type, status: 'active', id: org.id, claims: allClaims, alternateName: 'host',
      url: `${this.config.apiBaseUrl}/host`, sector: Sector.SYSTEM, sectorsAllowed: this.config.sectorsAllowed,
      didConfig: { service: [] }, didDocument: {} as any, meta: { lastUpdated: new Date().toISOString() },
    };

    const didId = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    hostConfig.didConfig.service = initializeHostServices(didId, this.config.sectorsAllowed);
    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: didId, alsoKnownAs: [] };
    hostConfig.didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);

    const docToProtect: ConfidentialStorageDoc = {
      id: logicalVaultId, // The document ID inside the tenants section is the logical ID
      sequence: 0,
      content: hostConfig,
    };

    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, logicalVaultId);
    await this.vaultRepository.put(hostCollectionName, [secureDoc], 'tenants');
    
    // The cache will be populated on-demand by getCollectionName. No need to force a reload.

    const [adminPerson, processedService] = contained;

    if (adminPerson) {
      const adminDoc: ConfidentialStorageDoc = { id: adminPerson.id, sequence: 0, content: adminPerson };
      const secureAdminDoc = await this.kmsService.protectConfidentialData(adminDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureAdminDoc], 'employees');
    }
    
    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureServiceDoc], 'services');
    }
  }

  private async persistTenantConfig(
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    contained: IncludedResource[],
    sector: Sector,
  ) {
    const vaultId = getTenantVaultId(sector, altName);
    const tenantCollectionName = generateTenantCollectionNameFromClaims(allClaims);
    
    await this.vaultRepository.createNewVault({ id: tenantCollectionName });
    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace, network: 'test-network',
      jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: sector, idType: allClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: allClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const context = { jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector: sector };
    const hostedDid = createHostedDidWeb(hostDid, altName, context);
    const publicTenantUrl = allClaims[ClaimsOrganizationSchemaorg.url] as string | undefined;
    const externalDid = publicTenantUrl && publicTenantUrl.startsWith('https://') ? `did:web:${new URL(publicTenantUrl).hostname}` : undefined;

    const primaryDid = externalDid || hostedDid;
    const alsoKnownAs = [tenantUrn];
    if (externalDid && primaryDid !== externalDid) alsoKnownAs.push(externalDid);
    if (hostedDid && primaryDid !== hostedDid) alsoKnownAs.push(hostedDid);

    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: primaryDid, alsoKnownAs: alsoKnownAs };
    const services = initializeTenantServices(tenantUrn, sector);
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    didDocument.service = services;

    const tenantConfig: EntityConfig = {
      type: org.type, status: 'active', id: org.id,
      claims: { ...allClaims, [ClaimsOrganizationSchemaorg.identifier]: tenantUrn },
      didConfig: { service: services }, didDocument: didDocument,
      meta: { lastUpdated: new Date().toISOString() },
    };

    // Build attributes for indexing based on the central configuration
    const attributes = AllowedIndexableClaims.organizationRegistry
    .map(claimKey => {
      const value = allClaims[claimKey];
      // Ensure value is not null or undefined before creating the attribute
      if (value === undefined || value === null) {
        return null;
      }
      return { 
        name: claimKey, 
        value: String(value),
        // Mark alternateName as unique
        ...(claimKey === ClaimsOrganizationSchemaorg.alternateName && { unique: true })
      };
    })
    .filter(Boolean) as { name: string; value: string; unique?: boolean }[];


    const tenantRegistrationDoc: ConfidentialStorageDoc = {
      id: vaultId, sequence: 0,
      indexed: {
        attributes: attributes,
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: tenantConfig,
    };

    const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
    if (!hostCollectionName) {
      // This should be an impossible state if bootstrap ran correctly.
      throw new ManagerError('Host configuration is not available. Cannot register new tenant.', IssueType.NotFound);
    }

    const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], 'tenants');
    
    // The cache will be populated on-demand by getCollectionName. No need to force a reload.

    const [legalRep, processedService] = contained;

    if (legalRep) {
      const legalRepDoc: ConfidentialStorageDoc = { id: legalRep.id, sequence: 0, content: legalRep };
      const secureLegalRepDoc = await this.kmsService.protectConfidentialData(legalRepDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureLegalRepDoc], 'employees');
    }

    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], 'services');
    }
  }

  private async _handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    if (!service) return undefined;
    const termsOfService = service.meta.claims[ClaimsServiceSchemaorg.termsOfService] as string;

    if (termsOfService && !termsOfService.startsWith('http')) {
      try {
        const pdfBytes = Buffer.from(termsOfService, 'base64');
        const { publicUrl, encodedMultiHash } = await this.storageAdapter.upload(pdfBytes, 'application/pdf');
        
        service.meta.claims[ClaimsServiceSchemaorg.termsOfService] = publicUrl;
        (service.meta.claims as any)[`${ClaimsServiceSchemaorg.termsOfService}#hash`] = encodedMultiHash;
      } catch (error) {
        throw new ManagerError(`Invalid Base64 encoding for service attachment.`, IssueType.Invalid);
      }
    }
    return service;
  }

  private extractResources(claims: ClaimsRecord, environment?: string) {
    const resourceTypes = ['Organization', 'Person', 'Service'];
    const resources: Record<string, any> = {};

    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = { '@type': type };
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
        resources[type.toLowerCase()] = {
          id: resourceId,
          type: type,
          meta: { claims: resourceClaims },
        };
      }
    }
    if (!resources.organization || !resources.person || !resources.service) {
      throw new ManagerError('Incomplete claims: Organization, Person, and Service resources are required.', IssueType.Required);
    }
    return resources as { organization: IncludedResource; person: IncludedResource; service: IncludedResource };
  }
}