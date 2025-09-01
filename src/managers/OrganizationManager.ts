// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/OrganizationManager.ts

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { isValidTenantAlternateName } from '../utils/tenant';
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantConfig } from '../models/tenant'; // Corrected import path
import { config } from '../config'; // For API base URL

interface IncludedResource {
  type: string;
  id: string;
  meta: {
    claims: Record<string, any>;
  };
}

export class OrganizationManager {

  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Registers a new organization by processing a job with interoperable claims.
   * @param job The job containing registration data.
   * @param environment The deployment environment (e.g., 'demo').
   * @returns A JSON:API document with the results.
   */
  async register(job: any, environment?: string): Promise<any> {
    const data = job.body.data;

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Invalid data: 'data' must be an array with at least one entry.");
    }

    const entry = data[0];
    const claims = entry.meta.claims;

    if (claims["@type"] !== "template") {
        throw new Error("Invalid @type: Top-level @type must be 'template'.");
    }

    const alternateName = claims[ClaimsOrgSchemaorg.alternateName];
    if (alternateName && !isValidTenantAlternateName(alternateName)) {
        throw new Error(`Invalid alternateName: '${alternateName}'. Tenant alternateName cannot start or end with 'host'.`);
    }
    if (!alternateName) {
        throw new Error("Missing required claim: org.schema.Organization.alternateName");
    }

    // --- Logic migrated from TenantManager ---
    const newTenantConfig: TenantConfig = {
      id: uuidv4(), // Generate a new internal ID for the config object
      alternateName: alternateName,
      legalName: claims[ClaimsOrgSchemaorg.legalName],
      identifier: claims[ClaimsOrgSchemaorg.taxID], // Assuming taxID is the primary identifier
      url: `${config.apiBaseUrl}/${alternateName}`,
      sector: claims[ClaimsServiceSchemaorg.category] || 'default',
      jurisdiction: claims[ClaimsOrgSchemaorg.addressCountry],
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: `did:web:${alternateName}`, // Simplified DID generation
        service: [], // Service endpoints can be added later
      },
      meta: {
        lastUpdated: new Date().toISOString()
      }
    };

    await this.vaultRepository.createNewVault({ id: alternateName, custodian: newTenantConfig.id });
    await this.vaultRepository.put('host', [newTenantConfig], 'tenants');
    // --- End of migrated logic ---

    // ... (rest of the resource extraction logic remains the same)
    
    const resourceTypes: string[] = [];
    for (const claimName in claims) {
      if (claimName.startsWith("org.schema.")) {
        const parts = claimName.split('.');
        if (parts.length > 1) {
          const resourceType = parts[1];
          if (!resourceTypes.includes(resourceType)) {
            resourceTypes.push(resourceType);
          }
        }
      }
    }
    
    const includedResources: IncludedResource[] = [];
    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = { "@type": type };
      let resourceId: string; // Ensure resourceId is always a string
      for (const claimName in claims) {
        if (claimName.startsWith(`org.schema.${type}.`)) {
          resourceClaims[claimName] = claims[claimName];
        }
      }
      
      const identifierClaim = claims[`org.schema.${type}.identifier`];
      const uuidPart = identifierClaim?.split('urn:uuid:')[1]?.split(',')[0];

      if (identifierClaim && environment !== 'demo' && uuidPart && uuidValidate(uuidPart)) {
        resourceId = uuidPart;
      } else {
        resourceId = uuidv4();
      }

      includedResources.push({
        type: type,
        id: resourceId, // Now this is guaranteed to be a string
        meta: { claims: resourceClaims },
      });
    }

    const templateId = uuidv4();
    const relationships: Record<string, any> = {};
    includedResources.forEach(res => {
        relationships[res.type.toLowerCase()] = { data: { type: res.type, id: res.id }};
    });

    const template = {
      type: "template",
      id: templateId,
      meta: {
        templateId: entry.meta.templateId,
        templateVersion: entry.meta.templateVersion,
        claims: claims
      },
      relationships: relationships
    };

    return {
      data: [template],
      included: includedResources
    };
  }
}

