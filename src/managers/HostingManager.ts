// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts

import { IServerConfig } from '../config';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { determineResourceId } from '../utils/resource';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { initializeHostServices, initializeTenantServices } from '../utils/services';
import { JobRequest } from '../models/request';
import { EntityConfig } from '../models/entity';
import { IPayloadResponse } from '../models/response';
import { IncludedResource } from '../models/jsonapi';
import { ClaimsRecord } from '../models/resource-document';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { ManagerError } from '../models/errors/manager-error';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { validateNewOrganizationClaims } from '../utils/claims-validator';
import { Sector } from '../models/urlPath';
import { TenantsCacheManager } from './TenantsCacheManager';
import { createHostedDidWeb, populateDidDocumentFromJwks, composeHostDidWebId, getPrimaryDidWeb } from '../utils/did';
import { DidDocument } from '../models/did';
import { createOrganizationUrn } from '../utils/urn';

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
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private config: IServerConfig;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    config: IServerConfig,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.config = config;
  }

  /**
   * A new, direct method to bootstrap the host. It bypasses the complex 'process'
   * logic and directly calls the persistence function. This makes startup reliable.
   * @param hostClaims The claims data for the host organization.
   */
  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    // console.log('[HostingManager] Starting direct bootstrap process...');
    const { organization, person, service } = this.extractResources(hostClaims);
    await this.persistHostConfig(organization, [person, service]);
    // console.log('[HostingManager] Direct bootstrap process finished.');
  }

  /**
   * Processes a registration job, handling one or more organization entries.
   * @param job The job object containing the registration claims.
   * @param environment The deployment environment (e.g., 'demo').
   * @param isBootstrap A flag indicating if the call is from the server's bootstrap process.
   * @returns A IPayloadResponse object with the outcome of the registration process.
   */
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

    // --- CORRECTED ISSUER LOGIC ---
    // The issuer for a registration response is always the Host.
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      thid: job.content.thid,
      iss: issuerDid,
      aud: job.content.iss,
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
      const alternateName = claims[ClaimsOrganizationSchemaorg.alternateName];

      if (!alternateName) {
        throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
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

        if (process.env.NODE_ENV !== 'production') {
          // console.log(`[DEBUG] HostingManager.processRegistrationEntry attempting to build vaultId with: validatedSector='${validatedSector}', alternateName='${alternateName}'`);
        }
        const vaultId = getTenantVaultId(validatedSector, alternateName);
        if (await this.vaultRepository.vaultExists(vaultId)) {
          throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
        }

        const tenants = await this.vaultRepository.getContainersInSection<EntityConfig>('host', 'tenants');
        if (
          tenants.some(
            t =>
              t.identifier === claims[ClaimsOrganizationSchemaorg.identifier] &&
              t.jurisdiction === claims[ClaimsOrganizationSchemaorg.addressCountry],
          )
        ) {
          throw new ManagerError(
            `Conflict: already exists the tenant '${claims[ClaimsOrganizationSchemaorg.identifier]}' issued by '${claims[ClaimsOrganizationSchemaorg.addressCountry]}' jurisdiction`,
            IssueType.Duplicate,
          );
        }
      }

      const { organization, person, service } = this.extractResources(claims, environment);

      // console.log(`[HostingManager] Processing entry for alternateName: '${alternateName}'`);
      if (alternateName === 'host') {
        // console.log(`[HostingManager] 'host' entry detected. Checking if vault exists...`);
        const hostVaultExists = await this.vaultRepository.vaultExists('host');
        // console.log(`[HostingManager] Does 'host' vault exist? ${hostVaultExists}`);
        if (!hostVaultExists) {
          // console.log(`[HostingManager] 'host' vault does not exist. Calling persistHostConfig.`);
          await this.persistHostConfig(organization, [person, service]);
        } else {
          // console.log(`[HostingManager] 'host' vault ALREADY EXISTS. Skipping persistHostConfig.`);
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
    // console.log(`[HostingManager] ENTERING persistHostConfig.`);    
    const vaultId = 'host';
    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    const hostConfig: EntityConfig = {
      type: org.type,
      status: 'active',
      id: org.id,
      claims: org.meta.claims,
      // Deprecated fields, kept for potential compatibility, but logic should use claims.
      identifier: org.meta.claims[ClaimsOrganizationSchemaorg.identifier] as string,
      alternateName: 'host',
      legalName: org.meta.claims[ClaimsOrganizationSchemaorg.legalName] as string,
      jurisdiction: org.meta.claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      url: `${this.config.apiBaseUrl}/host`,
      sector: Sector.SYSTEM,
      sectorsAllowed: this.config.sectorsAllowed,
      didConfig: {
        service: [],
      },
      didDocument: {} as any, 
      meta: { lastUpdated: new Date().toISOString() },
    };

    // Use the correct, restored function to define the host's DID
    const didId = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    hostConfig.didConfig.service = initializeHostServices(didId, hostConfig.sectorsAllowed);

    // Unify the logic: Build the host's DID document using the same robust utility as tenants.
    const skeletonDidDoc: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: didId,
      alsoKnownAs: [], // The host has no other aliases in this context
    };
    hostConfig.didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);

    const docToProtect: ConfidentialStorageDoc = {
      id: org.id,
      sequence: 0,
      content: hostConfig,
    };

    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, vaultId);

    await this.vaultRepository.createNewVault({ id: vaultId, custodian: secureDoc.id });
    await this.vaultRepository.put(vaultId, [secureDoc], 'tenants');

    // console.log(`[HostingManager] Host config persisted. Forcing cache reload NOW.`);
    await this.tenantsCacheManager.loadTenants();
  }

  /**
   * Constructs a new tenant's EntityConfig and persists it in the host's vault.
   * This method is the core of the tenant creation logic and follows the "Golden Rules of Identity".
   *
   * @param org The main Organization resource extracted from the claims.
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
    // console.log(`[HostingManager] Persisting new tenant config with vaultId: '${vaultId}'`);
    
    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    // 1. Construct the canonical URN for the tenant using the existing utility.
    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: 'test-network', // New tenants are always enrolled in the 'test-network' first.
      jurisdiction: org.meta.claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: sector,
      idType: org.meta.claims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: org.meta.claims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });

    // 2. Construct the hosted and external did:web identifiers.
    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const jurisdiction = org.meta.claims[ClaimsOrganizationSchemaorg.addressCountry] as string;
    const context = {
      jurisdiction: jurisdiction,
      version: 'v1', // TODO: Source this from a centralized configuration constant
      sector: sector,
    };
    const hostedDid = createHostedDidWeb(hostDid, altName, context);
    const publicTenantUrl = org.meta.claims[ClaimsOrganizationSchemaorg.url] as string | undefined;
    const externalDid = publicTenantUrl && publicTenantUrl.startsWith('https://') 
      ? `did:web:${new URL(publicTenantUrl).hostname}` 
      : undefined;

    // 3. Determine the primary DID and construct the DID Document skeleton.
    const primaryDid = externalDid || hostedDid;
    const alsoKnownAs = [tenantUrn];
    if (externalDid && primaryDid === hostedDid) {
      alsoKnownAs.push(externalDid);
    } else if (hostedDid && primaryDid === externalDid) {
      alsoKnownAs.push(hostedDid);
    }

    const skeletonDidDoc: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: primaryDid, // The primary identifier is the resolvable did:web
      alsoKnownAs: alsoKnownAs, // Other identifiers, including the canonical URN
    };

    // 4. Generate the service configuration templates.
    const services = initializeTenantServices(tenantUrn, sector);

    // 5. Populate the full DID document by multiplexing the keys and adding services.
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    didDocument.service = services;

    // 6. Construct the final EntityConfig for the tenant.
    const tenantConfig: EntityConfig = {
      type: org.type,
      status: 'active',
      id: org.id,
      claims: {
        ...org.meta.claims,
        [ClaimsOrganizationSchemaorg.identifier]: tenantUrn,
      },
      didConfig: {
        service: services, // Store the services in the config for internal use
      },
      didDocument: didDocument,
      meta: { lastUpdated: new Date().toISOString() },
    };

    // 7. Construct the document to be protected by the KMS.
    const docToProtect: ConfidentialStorageDoc = {
      id: org.id,
      sequence: 0,
      indexed: {
        attributes: [
          { name: 'alternateName', value: altName, unique: true },
          { name: 'taxId', value: org.meta.claims[ClaimsOrganizationSchemaorg.identifierValue] as string },
        ],
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: tenantConfig,
    };

    // 8. Encrypt and persist the new tenant's configuration.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, 'host');
    await this.vaultRepository.createNewVault({ id: vaultId, custodian: secureDoc.id });
    await this.vaultRepository.put('host', [secureDoc], 'tenants');

    // 9. Force a cache reload to make the new tenant immediately available.
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

