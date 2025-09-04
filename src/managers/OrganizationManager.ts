// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/OrganizationManager.ts

import { v4 as uuidv4 } from 'uuid';
import { isValidTenantAlternateName } from '../utils/tenant';
import { ClaimsOrgSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantConfig } from '../models/tenant';
import { config } from '../config';
import { IncludedResource } from '../models/jsonapi';
import { determineResourceId } from '../utils/resource';
import { ICryptography } from '../security/interfaces/ICryptography';
import { ClaimsRecord } from '../models/resource-document';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { JweObject } from '../security/interfaces/Cryptography.types';
import { IKmsService } from '../security/interfaces/IKmsService';

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
   * @returns A HybridPayload object with a data array of processed entries.
   */
  async register(job: any, environment?: string): Promise<{ data: any[] }> {
    const jobEntries = job?.body?.data || job?.body?.entry || [];
    const responseEntries: any[] = [];

    for (const entry of jobEntries) {
        const claims = entry?.meta?.claims;
        if (!claims) {
            // Handle malformed entry
            continue;
        }

        try {
    const alternateName = claims[ClaimsOrgSchemaorg.alternateName];

            // --- Pre-flight validations ---
            if (alternateName && alternateName !== 'host') {
        if (!isValidTenantAlternateName(alternateName)) {
                    throw new Error(`Invalid alternateName format: '${alternateName}'`);
        }
                if (await this.vaultRepository.vaultExists(alternateName)) {
                    throw new Error(`Conflict: alternateName '${alternateName}' already exists`);
                }
                const tenants = await this.vaultRepository.getContainersInSection<TenantConfig>('host', 'tenants');
                if (tenants.some(t => t.identifier === claims[ClaimsOrgSchemaorg.taxID] && t.jurisdiction === claims[ClaimsOrgSchemaorg.addressCountry])) {
                    throw new Error(`Conflict: taxID '${claims[ClaimsOrgSchemaorg.taxID]}' already exists in country '${claims[ClaimsOrgSchemaorg.addressCountry]}'`);
                }
            }
        
            // --- Resource Extraction ---
            const { organization, person, service } = this.extractResources(claims, environment);

            // --- Persistence (for tenants only) ---
            if (alternateName && alternateName !== 'host') {
                await this.persistTenantConfig(organization, alternateName, [person, service]);
            }
            // --- Build Success Entry ---
            responseEntries.push({
                id: organization.id,
                type: 'Organization',
                meta: { ...entry.meta }, // Preserve original meta
                resource: {
                    ...organization,
                    contained: [person, service]
      },
                response: { status: '201' }
            });

        } catch (error: any) {
            // --- Build Error Entry ---
            const status = error.message.startsWith('Conflict') ? '409' : '400';
            responseEntries.push({
                meta: { ...entry.meta },
                response: { status, outcome: { issue: [{ severity: 'error', details: { text: error.message } }] } }
            });
        }
    }

    return { data: responseEntries };
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
        const secureDoc = await this.kmsService.protectDocument(docToProtect, org.id);

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
            const identifierClaim = claims[`org.schema.${type}.identifier`];
            const resourceId = determineResourceId(identifierClaim, environment);
            resources[type.toLowerCase()] = {
                id: resourceId,
                type: type,
                meta: { claims: resourceClaims },
    };
        }
    }
    if (!resources.organization || !resources.person || !resources.service) {
        throw new Error('Incomplete claims: Organization, Person, and Service resources are required.');
    }
    return resources as { organization: IncludedResource, person: IncludedResource, service: IncludedResource };
  }
}


