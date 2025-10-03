// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts

import { IServerConfig } from '../config';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { determineResourceId } from '../utils/resource';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { getBundleResponseTypeForAction } from '../utils/bundle';
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
import { validateNewOrganizationClaims } from '../utils/claims-validator';
import { Sector } from '../models/sector';
import { TenantsCacheManager } from './TenantsCacheManager';
import { DidDocumentBuilder } from '../services/DidDocumentBuilder';

/**
 * Manages the business logic for HOSTING, including new tenant registration.
 * It accepts dependencies for repository and a Key Management Service.
 *
 * @architecture-warning
 * This manager writes directly to the `VaultRepository` after creating a new tenant.
 * To solve cache coherency issues in a multi-node environment, it directly
 * calls the TenantsCacheManager to force a reload. A more robust implementation
 * would use a Pub/Sub system (e.g., Redis, Google Cloud Pub/Sub) to signal all
 * nodes to reload their tenant cache after a new tenant is persisted.
 */
export class HostingManager {
  private vaultRepository: VaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private config: IServerConfig;
  private didDocumentBuilder: DidDocumentBuilder;

  constructor(
    vaultRepository: VaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    config: IServerConfig,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.config = config;
    this.didDocumentBuilder = new DidDocumentBuilder();
  }

  /**
   * A new, direct method to bootstrap the host. It bypasses the complex 'process'
   * logic and directly calls the persistence function. This makes startup reliable.
   * @param hostClaims The claims data for the host organization.
   */
  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    console.log('[HostingManager] Starting direct bootstrap process...');
    const { organization, person, service } = this.extractResources(hostClaims);
    await this.persistHostConfig(organization, [person, service]);
    console.log('[HostingManager] Direct bootstrap process finished.');
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

    // This part is now tricky because getTenantDidWebId and getHostDidWebId were deleted.
    // For now, we will construct a simplified issuer DID.
    // TODO: Refactor DID utilities to be injectable or receive config.
    const issuerDid =
      job.tenantId && job.tenantId !== 'host'
        ? `did:web:${this.config.apiHostname}:${job.tenantId}`
        : `did:web:${this.config.apiHostname}`;

    return {
      thid: job.input.thid,
      iss: issuerDid,
      aud: job.input.iss,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

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
          outcome: createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Malformed entry: missing meta.claims'),
        },
      };
    }

    try {
      validateNewOrganizationClaims(claims);
      const alternateName = claims[ClaimsOrgSchemaorg.alternateName];

      if (!alternateName) {
        throw new ManagerError(`Missing required claim: '${ClaimsOrgSchemaorg.alternateName}'`, IssueType.Required);
      }

      let validatedSector: Sector | undefined;

      if (alternateName !== 'host') {
        if (!isValidTenantAlternateName(alternateName)) {
          throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
        }

        const requestedSector = claims[ClaimsServiceSchemaorg.category];
        if (!requestedSector) {
          throw new ManagerError(
            `Missing required claim for new tenant: '${ClaimsServiceSchemaorg.category}'`,
            IssueType.Required,
          );
        }
        if (requestedSector === Sector.SYSTEM) {
          throw new ManagerError(
            "The 'system' sector is a reserved keyword and cannot be used by tenants.",
            IssueType.Forbidden,
          );
        }
        if (!this.config.sectorsAllowed.includes(requestedSector as Sector)) {
          throw new ManagerError(
            `The requested sector '${requestedSector}' is not supported by this gateway.`,
            IssueType.Value,
          );
        }
        validatedSector = requestedSector as Sector;

        const vaultId = getTenantVaultId(validatedSector, alternateName);
        if (await this.vaultRepository.vaultExists(vaultId)) {
          throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
        }

        const tenants = await this.vaultRepository.getContainersInSection<TenantConfig>('host', 'tenants');
        if (
          tenants.some(
            t =>
              t.identifier === claims[ClaimsOrgSchemaorg.identifier] &&
              t.jurisdiction === claims[ClaimsOrgSchemaorg.addressCountry],
          )
        ) {
          throw new ManagerError(
            `Conflict: already exists the tenant '${claims[ClaimsOrgSchemaorg.identifier]}' issued by '${claims[ClaimsOrgSchemaorg.addressCountry]}' jurisdiction`,
            IssueType.Duplicate,
          );
        }
      }

      const { organization, person, service } = this.extractResources(claims, environment);

      console.log(`[HostingManager] Processing entry for alternateName: '${alternateName}'`);
      if (alternateName === 'host') {
        console.log(`[HostingManager] 'host' entry detected. Checking if vault exists...`);
        const hostVaultExists = await this.vaultRepository.vaultExists('host');
        console.log(`[HostingManager] Does 'host' vault exist? ${hostVaultExists}`);
        if (!hostVaultExists) {
          console.log(`[HostingManager] 'host' vault does not exist. Calling persistHostConfig.`);
          await this.persistHostConfig(organization, [person, service]);
        } else {
          console.log(`[HostingManager] 'host' vault ALREADY EXISTS. Skipping persistHostConfig.`);
        }
      } else {
        await this.persistTenantConfig(organization, alternateName, [person, service], validatedSector!);
      }

      return {
        type: entryType,
        resource: {
          resourceType: 'Organization',
          id: organization.id,
          meta: organization.meta,
          contained: [person, service],
        },
        response: { status: '201' },
      };
    } catch (error: any) {
      // Use the existing helper function to create the error outcome
      return this.handleError(error, entryType, entry.meta);
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
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.',
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
    console.log(`[HostingManager] ENTERING persistHostConfig.`);    
    const vaultId = 'host';
    // 1. Provision the keys for the 'host' entity first.
    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    // 2. Construct the host's own TenantConfig object.
    const hostConfig: TenantConfig = {
      id: org.id,
      claims: {},
      identifier: org.meta.claims[ClaimsOrgSchemaorg.identifier],
      alternateName: 'host',
      legalName: org.meta.claims[ClaimsOrgSchemaorg.legalName],
      jurisdiction: org.meta.claims[ClaimsOrgSchemaorg.addressCountry],
      url: `${this.config.apiBaseUrl}/host`,
      sector: Sector.SYSTEM,
      sectorsAllowed: this.config.sectorsAllowed,
      didConfig: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: `did:web:${this.config.apiHostname}`,
        service: [],
      },
      didDocument: {} as any, // Placeholder, will be generated next
      meta: { lastUpdated: new Date().toISOString() },
    };

    // 2a. Generate the service configuration templates.
    hostConfig.didConfig.service = initializeHostServices(hostConfig);

    // 2b. Generate the static, public DID Document.
    hostConfig.didDocument = this.didDocumentBuilder.build({
      didId: hostConfig.didConfig.id,
      baseUrl: `${this.config.apiBaseUrl}/host/cds-${hostConfig.jurisdiction}/v1`,
      publicKeysJwk: publicKeys,
      configServices: hostConfig.didConfig.service,
    });

    // 3. Construct the document to be protected.
    const docToProtect: ConfidentialStorageDoc = {
      id: org.id,
      sequence: 0,
      content: hostConfig,
    };

    // 4. Request protection from the KMS, using its own 'host' keys.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);

    // 5. Create the host's own vault and persist its configuration inside it.
    await this.vaultRepository.createNewVault({ id: vaultId, custodian: secureDoc.id });
    await this.vaultRepository.put(vaultId, [secureDoc], 'tenants');

    // DEPRECATED NOTE: Cache reloading for the host is handled by the main server startup sequence
    // in server.ts AFTER this bootstrap process completes.

    // NEW NOTE: Force a cache reload to ensure the host tenant is immediately available.
    console.log(`[HostingManager] Host config persisted. Forcing cache reload NOW.`);
    await this.tenantsCacheManager.loadTenants();
  }

  /**
   * Constructs a new tenant's TenantConfig and persists it in the host's vault.
   * This follows the 'Secure Persistence Flow' architectural pattern.
   * @param org The main Organization resource.
   * @param altName The alternateName for the tenant's vault.
   * @param contained An array of contained resources (Person, Service).
   * @param sector The validated business sector for the new tenant.
   */

  private async persistTenantConfig(
    org: IncludedResource,
    altName: string,
    contained: IncludedResource[],
    sector: Sector,
  ) {
    const vaultId = getTenantVaultId(sector, altName);
    console.log(`[HostingManager] Persisting new tenant config with vaultId: '${vaultId}'`);
    // 1. Provision the cryptographic keys for the new tenant.
    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    // --- Determine the tenant's domain and URL with a fallback mechanism ---
    const tenantUrlClaim = org.meta.claims[ClaimsOrgSchemaorg.url];
    let tenantDomain: string;
    let tenantUrl: string;

    if (tenantUrlClaim && typeof tenantUrlClaim === 'string' && tenantUrlClaim.startsWith('https://')) {
      try {
        const parsedUrl = new URL(tenantUrlClaim);
        tenantDomain = parsedUrl.hostname;
        tenantUrl = tenantUrlClaim;
      } catch (e) {
        tenantDomain = this.config.hostExternalDomain;
        tenantUrl = `${this.config.apiBaseUrl}/${altName}`;
      }
    } else {
      tenantDomain = this.config.hostExternalDomain;
      tenantUrl = `${this.config.apiBaseUrl}/${altName}`;
    }

    const tenantDidId = tenantDomain.includes(this.config.apiHostname)
      ? `did:web:${tenantDomain}:${altName}`
      : `did:web:${tenantDomain}`;

    const tenantConfig: TenantConfig = {
      id: org.id,
      claims: {},
      identifier: org.meta.claims[ClaimsOrgSchemaorg.identifier],
      alternateName: altName,
      legalName: org.meta.claims[ClaimsOrgSchemaorg.legalName],
      jurisdiction: org.meta.claims[ClaimsOrgSchemaorg.addressCountry],
      url: tenantUrl,
      sector: sector,
      didConfig: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: tenantDidId,
        service: [],
      },
      didDocument: {} as any, // Placeholder, will be generated next
      meta: { lastUpdated: new Date().toISOString() },
    };

    // 1a. Generate the service configuration templates.
    tenantConfig.didConfig.service = initializeTenantServices(tenantConfig);

    // 1b. Generate the static, public DID Document.
    tenantConfig.didDocument = this.didDocumentBuilder.build({
      didId: tenantConfig.didConfig.id,
      baseUrl: `${this.config.apiBaseUrl}/${altName}/cds-${tenantConfig.jurisdiction}/v1`,
      publicKeysJwk: publicKeys,
      configServices: tenantConfig.didConfig.service,
    });

    // 2. Manager: Construct the complete plaintext document for the KMS.
    const docToProtect: ConfidentialStorageDoc = {
      id: org.id,
      sequence: 0,
      indexed: [
        {
          attributes: [
            { name: 'alternateName', value: altName, unique: true },
            { name: 'taxId', value: org.meta.claims[ClaimsOrgSchemaorg.identifier] },
          ],
          hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
        },
      ],
      content: tenantConfig,
    };

    // The KMS is responsible for serialization, encryption, and removing the .content property.
    // The 'host' is always the protector of a new tenant's configuration.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, 'host');

    await this.vaultRepository.createNewVault({ id: vaultId, custodian: secureDoc.id });
    await this.vaultRepository.put('host', [secureDoc], 'tenants');

    // As per the architecture warning, force a cache reload to ensure the new tenant
    // is immediately available to the API without a server restart.
    await this.tenantsCacheManager.loadTenants();
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
      throw new ManagerError(
        'Incomplete claims: Organization, Person, and Service resources are required.',
        IssueType.Required,
      );
    }
    return resources as { organization: IncludedResource; person: IncludedResource; service: IncludedResource };
  }
}
