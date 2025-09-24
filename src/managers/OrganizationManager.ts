// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/OrganizationManager.ts

import { config } from '../config';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { determineResourceId } from '../utils/resource';
import { createOperationOutcome } from '../utils/outcome';
import { isValidTenantAlternateName } from '../utils/tenant';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getHostDidWebId, getTenantDidWebId } from '../utils/did';
import { initializeHostServices, initializeTenantServices } from '../utils/services';
import { JobRequest } from '../models/request';
import { TenantConfig } from '../models/tenant';
import { IPayloadResponse } from '../models/response';
import { IncludedResource } from '../models/jsonapi';
import { ClaimsRecord } from '../models/resource-document';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { ClaimsOrgSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';

/**
 * Manages the business logic for organization registration.
 * It accepts dependencies for repository and a Key Management Service.
 * 
 * @architecture-warning
 * This manager writes directly to the `VaultRepository` after creating a new tenant.
 * In a distributed, multi-node environment (like Kubernetes), this will cause cache
 * coherency issues.
 * 
 * The `TenantsCacheManager` on other nodes will not be aware of the
 * new tenant, leading to potential 404 errors for requests routed to those nodes.
 * A proper implementation requires a cache invalidation mechanism, such as a Pub/Sub
 * system (e.g., Redis, Google Cloud Pub/Sub), to signal all nodes to reload their
 * tenant cache after a new tenant is persisted.
 */
export class OrganizationManager {

  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;

  constructor(vaultRepository: VaultRepository, kmsService: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  /**
   * Processes a registration job, handling one or more organization entries.
   * @param job The job object containing the registration claims.
   * @param environment The deployment environment (e.g., 'demo').
   * @param isBootstrap A flag indicating if the call is from the server's bootstrap process.
   * @returns A IPayloadResponse object with the outcome of the registration process.
   */
  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IPayloadResponse> {
    const jobEntries = job?.input?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processRegistrationEntry(entry, environment);
        responseEntries.push(resultEntry);
      } catch (error) {
        if (isBootstrap) {
          // During bootstrap, any error is fatal and should halt the server startup.
          throw error;
        }
        // For regular API calls, create a standard error entry in the response bundle.
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    const issuerDid = (job.tenantId && job.tenantId !== 'host')
      ? getTenantDidWebId(job.tenantId)
      : getHostDidWebId();

    return {
      thid: job.input.thid,
      iss: issuerDid,
      aud: job.input.iss,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

// src/managers/OrganizationManager.ts
  /**
   * Processes a single organization registration entry.
   * @param entry The individual entry from the job payload, which includes the 'type'.
   * @param environment The deployment environment.
   * @returns A BundleEntry representing the outcome (success or error).
   */
  private async processRegistrationEntry(entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const claims = entry?.meta?.claims;
    const entryType = entry.type || 'Organization-unknown';

    if (!claims) {
      return {
        type: entryType,
        response: {
          status: '400',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Required,
            'Malformed entry: missing meta.claims'
          ),
        },
      };
    }

    try {
        const alternateName = claims[ClaimsOrgSchemaorg.alternateName];

        // --- Pre-flight validations ---
        if (!alternateName) {
            throw new ManagerError(`Missing required claim: '${ClaimsOrgSchemaorg.alternateName}'`, IssueType.Required);
        }
        if (alternateName !== 'host') {
            if (!isValidTenantAlternateName(alternateName)) {
                throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
            }
            if (await this.vaultRepository.vaultExists(alternateName)) {
                throw new ManagerError(`Conflict: a vault for alternateName '${alternateName}' already exists`, IssueType.Conflict);
            }
            // --- Sector Validation ---
            const requestedSector = claims[ClaimsServiceSchemaorg.category];
            if (!requestedSector) {
                throw new ManagerError(`Missing required claim for new tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
            }
            if (requestedSector === 'system') {
                throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
            }
            if (!config.sectorsAllowed.includes(requestedSector)) {
                throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
            }
            // ---
            const tenants = await this.vaultRepository.getContainersInSection<TenantConfig>('host', 'tenants');
            if (tenants.some(t => t.identifier === claims[ClaimsOrgSchemaorg.taxID] && t.jurisdiction === claims[ClaimsOrgSchemaorg.addressCountry])) {
                throw new ManagerError(`Conflict: already exists the taxID '${claims[ClaimsOrgSchemaorg.taxID]}' issued by '${claims[ClaimsOrgSchemaorg.addressCountry]}' jurisdiction`, IssueType.Duplicate);
            }
        }

        // --- Resource Extraction ---
        const { organization, person, service } = this.extractResources(claims, environment);

        // --- Persistence & Key Provisioning ---
        if (alternateName === 'host') {
            // This is the special bootstrap flow for the host itself.
            // We ensure it only runs once by checking if the host vault already exists.
            if (!await this.vaultRepository.vaultExists('host')) {
                await this.persistHostConfig(organization, [person, service]);
            }
        } else {
            // This is the standard flow for a new tenant.
            await this.persistTenantConfig(organization, alternateName, [person, service]);
        }

        // --- Build Success Entry ---
        return {
            type: entryType,
            resource: {
              resourceType: 'Organization',
              id: organization.id,
              meta: organization.meta,
              contained: [person, service]
            },
            response: { status: '201' }
        };

    } catch (error: any) {
      if (error instanceof ManagerError) {
        return {
          type: entryType,
          meta: entry.meta,
          response: {
            status: error.status,
            outcome: createOperationOutcome(
              IssueLevel.Error,
              error.code,
              error.message
            ),
          },
        };
      } else {
        // Log the unexpected error for debugging purposes.
        console.error('Unexpected error during registration processing:', error);

        // Return a generic 500 error entry.
        return {
          type: entryType,
          meta: entry.meta,
          response: {
            status: '500',
            outcome: createOperationOutcome(
              IssueLevel.Error,
              IssueType.Exception,
              'An unexpected internal server error occurred.'
            ),
          },
        };
      }
    }
  }

  /**
   * Handles errors during entry processing and converts them into a standardized ErrorEntry.
   * @param error The error caught during processing.
   * @param entryType The type of the entry that caused the error.
   * @param meta The metadata from the original entry.
   * @returns A formatted ErrorEntry object.
   */
  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta: meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(
            IssueLevel.Error,
            error.code,
            error.message
          ),
        },
      };
    } else {
      console.error('Unexpected error during registration processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.'
          ),
        },
      };
    }
  }

  /**
   * Persists the host's own configuration document in its own vault.
   * This is a special, one-time operation during server bootstrap.
   * @param org The host's Organization resource.
   * @param contained An array of the host's contained resources (Person, Service).
   */
  private async persistHostConfig(org: IncludedResource, contained: IncludedResource[]) {
      // 1. Provision the keys for the 'host' entity first.
      await this.kmsService.provisionKeys('host');

      const service = contained.find(r => r.type === 'Service')!;
      
      // 2. Construct the host's own TenantConfig object.
      const hostConfig: TenantConfig = {
          id: org.id,
          identifier: org.meta.claims[ClaimsOrgSchemaorg.identifier],
          alternateName: 'host',
          legalName: org.meta.claims[ClaimsOrgSchemaorg.legalName],
          jurisdiction: org.meta.claims[ClaimsOrgSchemaorg.addressCountry],
          url: `${config.apiBaseUrl}/host`,
          /**
           * The 'system' sector is a reserved keyword for the host's bootstrap process.
           * It it not available for the API.
           */          
          sector: 'system',
          // sectorsAllowed will be read from the global config
          sectorsAllowed: config.sectorsAllowed,
          didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: `did:web:${config.apiHostname}`, service: [] },
          meta: { lastUpdated: new Date().toISOString() }
      };

      // 2a. Generate the complete service list for the host.
      hostConfig.didDocument.service = initializeHostServices(hostConfig);

      // 3. Construct the document to be protected.
      const docToProtect: ConfidentialStorageDoc = {
          id: org.id,
          sequence: 0,
          content: hostConfig
      };

      // 4. Request protection from the KMS, using its own 'host' keys.
      const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, 'host');

      // 5. Create the host's own vault and persist its configuration inside it.
      await this.vaultRepository.createNewVault({ id: 'host', custodian: secureDoc.id });
      await this.vaultRepository.put('host', [secureDoc], 'tenants');
  }

  /**
   * Constructs a new tenant's TenantConfig and persists it in the host's vault.
   * This follows the 'Secure Persistence Flow' architectural pattern.
   * @param org The main Organization resource.
   * @param altName The alternateName for the tenant's vault.
   * @param contained An array of contained resources (Person, Service).
   */
  private async persistTenantConfig(org: IncludedResource, altName: string, contained: IncludedResource[]) {
      const person = contained.find(r => r.type === 'Person')!;
      const service = contained.find(r => r.type === 'Service')!;

      const tenantConfig: TenantConfig = {
          id: org.id,
          identifier: org.meta.claims[ClaimsOrgSchemaorg.identifier],
          alternateName: altName,
          legalName: org.meta.claims[ClaimsOrgSchemaorg.legalName],
          jurisdiction: org.meta.claims[ClaimsOrgSchemaorg.addressCountry],
          url: `${config.apiBaseUrl}/${altName}`,
          sector: service.meta.claims[ClaimsServiceSchemaorg.category] || 'default',
          didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: `did:web:${config.apiHostname}:${altName}`, service: [] },
          meta: { lastUpdated: new Date().toISOString() }
      };

      // 1a. Generate the complete service list for the new tenant.
      tenantConfig.didDocument.service = initializeTenantServices(tenantConfig);

      // 2. Manager: Construct the complete plaintext document for the KMS.
      const docToProtect: ConfidentialStorageDoc = {
          id: org.id,
          sequence: 0,
          indexed: [{
              attributes: [
                  { name: 'alternateName', value: altName, unique: true },
                  { name: 'taxId', value: org.meta.claims[ClaimsOrgSchemaorg.taxID] },
              ],
              hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' }
          }],
          content: tenantConfig
      };

      // The KMS is responsible for serialization, encryption, and removing the .content property.
      // The 'host' is always the protector of a new tenant's configuration.
      const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, 'host');

      await this.vaultRepository.createNewVault({ id: altName, custodian: secureDoc.id });
      await this.vaultRepository.put('host', [secureDoc], 'tenants');
  }

  /**
   * Extracts and builds the Organization, Person, and Service resources from a flat claims object.
   * @param claims The flat map of schema.org claims.
   * @param environment The deployment environment.
   * @returns An object containing the three main resource objects.
   */
  private extractResources(claims: ClaimsRecord, environment?: string) {
    const resourceTypes = ['Organization', 'Person', 'Service'];
    const resources: Record<string, any> = {};

    for (const type of resourceTypes) {
        const resourceClaims: Record<string, any> = { "@type": type };
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
    return resources as { organization: IncludedResource, person: IncludedResource, service: IncludedResource };
  }
}
