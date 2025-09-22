// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/OrganizationManager.ts

import { config } from '../config';
import { determineResourceId } from '../utils/resource';
import { isValidTenantAlternateName } from '../utils/tenant';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { TenantConfig } from '../models/tenant';
import { IncludedResource } from '../models/jsonapi';
import { ClaimsRecord } from '../models/resource-document';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { ClaimsOrgSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { Bundle, BundleEntry, ErrorEntry } from '../models/bundle';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { ManagerError } from '../models/errors/manager-error';
import { IPayloadResponse } from '../models/response';
import { JobRequest } from '../models/request';
import { getHostDidWebId, getTenantDidWebId } from '../utils/did';

/**
 * Manages the business logic for organization registration.
 * It accepts dependencies for repository and a Key Management Service.
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
   * @returns A IPayloadResponse object with the outcome of the registration process.
   */
  async process(job: JobRequest, environment?: string): Promise<IPayloadResponse> {
    const jobEntries = job?.input?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      const resultEntry = await this.processRegistrationEntry(entry, environment);
      responseEntries.push(resultEntry);
    }

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    const issuerDid = (job.tenantId && job.tenantId !== 'host')
      ? getTenantDidWebId(job.tenantId)
      : getHostDidWebId();

    // TODO: The JARM claims (iss, aud, exp) should be dynamically determined.
    // iss: From service configuration (our DID/URL).
    // aud: From the original request's client_id or equivalent property in the job.
    // exp: Current time + a configured TTL (e.g., 5 minutes).
    return {
      thid: job.input.thid,
      iss: issuerDid,
      aud: job.input.iss,                  // The response is for the original requester
      exp: Math.floor(Date.now() / 1000) + 300, // Placeholder: expires in 5 minutes
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
    // As per our simplified design, we trust and reflect the type from the client.
    // We provide a fallback if the type is missing from the request entry.
    const entryType = entry.type || 'Organization-unknown';

    // For now, we "accept anything" as requested.

    if (!claims) {
      const error = new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
      return {
        type: entryType,
        response: {
          status: error.status,
          outcome: {
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: IssueLevel.Error,
                code: error.code,
                diagnostics: error.message,
              },
            ],
          },
        },
      };
    }

    try {
        const alternateName = claims[ClaimsOrgSchemaorg.alternateName];

        // --- Pre-flight validations ---
        if (alternateName && alternateName !== 'host') {
            if (!isValidTenantAlternateName(alternateName)) {
                throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
            }
            if (await this.vaultRepository.vaultExists(alternateName)) {
                throw new ManagerError(`Conflict: a vault for alternateName '${alternateName}' already exists`, IssueType.Conflict);
            }
            const tenants = await this.vaultRepository.getContainersInSection<TenantConfig>('host', 'tenants');
            if (tenants.some(t => t.identifier === claims[ClaimsOrgSchemaorg.taxID] && t.jurisdiction === claims[ClaimsOrgSchemaorg.addressCountry])) {
                throw new ManagerError(`Conflict: already exists the taxID '${claims[ClaimsOrgSchemaorg.taxID]}' issued by '${claims[ClaimsOrgSchemaorg.addressCountry]}' jurisdiction`, IssueType.Duplicate);
            }
        }

        // --- Resource Extraction ---
        const { organization, person, service } = this.extractResources(claims, environment);

        // --- Persistence (for tenants only) ---
        if (alternateName && alternateName !== 'host') {
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
            outcome: {
              resourceType: 'OperationOutcome',
              issue: [{
                severity: IssueLevel.Error,
                code: error.code,
                diagnostics: error.message,
              },
            ]},
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
            outcome: {
              resourceType: 'OperationOutcome',
              issue: [{
                severity: IssueLevel.Error,
                code: IssueType.Exception,
                diagnostics: 'An unexpected internal server error occurred.',
              }],
            },
          },
        };
      }
    }
  }

    /**
     * Constructs the TenantConfig, builds a ConfidentialStorageDoc,
     * requests protection from the KMS, and persists the final secure document.
     * This follows the 'Secure Persistence Flow' architectural pattern.
     * @param org The main Organization resource.
     * @param altName The alternateName for the tenant's vault.
     * @param contained An array of contained resources (Person, Service).
     */
    private async persistTenantConfig(org: IncludedResource, altName: string, contained: IncludedResource[]) {
        const person = contained.find(r => r.type === 'Person')!;
        const service = contained.find(r => r.type === 'Service')!;

        // 1. Manager: Construct the business object (the content).
        const tenantConfig: TenantConfig = {
            id: org.id,
            identifier: org.meta.claims[ClaimsOrgSchemaorg.identifier],
            alternateName: altName,
            legalName: org.meta.claims[ClaimsOrgSchemaorg.legalName],
            jurisdiction: org.meta.claims[ClaimsOrgSchemaorg.addressCountry],
            url: `${config.apiBaseUrl}/${altName}`,
            sector: service.meta.claims[ClaimsServiceSchemaorg.category] || 'default',
            didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: `did:web:${altName}`, service: [] },
            meta: { lastUpdated: new Date().toISOString() }
        };

        // 2. Manager: Construct the complete plaintext document for the KMS.
        const docToProtect: ConfidentialStorageDoc = {
            id: org.id,
            sequence: 0,
            indexed: [{
                attributes: [
                    { name: 'alternateName', value: altName, unique: true },
                    { name: 'taxId', value: org.meta.claims[ClaimsOrgSchemaorg.taxID] },
                ],
                // HMAC details are placeholders for now as per architecture.
                hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' }
            }],
            content: tenantConfig // The plaintext content.
        };

        // 3. Manager: Request protection from the KMS.
        // The KMS is responsible for serialization, encryption, and removing the .content property.
        const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, org.id);

        // 4. Manager: Persist the final secure document.
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

