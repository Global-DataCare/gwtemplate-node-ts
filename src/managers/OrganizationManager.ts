// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/OrganizationManager.ts

import { v4 as uuidv4 } from 'uuid';
import { isValidTenantAlternateName } from '../utils/tenant';
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../models/schemaorg';
import { VaultRepository } from '../database/repositories/vault/vault.repository';
import { TenantConfig } from '../models/tenant';
import { config } from '../config';
import { IncludedResource } from '../models/jsonapi';
import { determineResourceId } from '../utils/resource';

export class OrganizationManager {

  private vaultRepository: VaultRepository;

  constructor(vaultRepository: VaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  public async register(job: any, environment?: string): Promise<any> {
    // 1. --- Initial Validation ---
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

    // 2. --- Handle alternateName and Tenant-Specific Logic ---
    if (alternateName !== 'host') {
        if (!alternateName) {
            throw new Error("Missing required claim: org.schema.Organization.alternateName");
        }
        if (!isValidTenantAlternateName(alternateName)) {
            throw new Error(`Invalid alternateName: '${alternateName}'. Tenant alternateName cannot start or end with 'host'.`);
        }
        
        const newTenantConfig: TenantConfig = {
          id: uuidv4(),
      alternateName: alternateName,
          legalName: claims[ClaimsOrgSchemaorg.legalName],
          identifier: claims[ClaimsOrgSchemaorg.taxID],
          url: `${config.apiBaseUrl}/${alternateName}`,
          sector: claims[ClaimsServiceSchemaorg.category] || 'default',
          jurisdiction: claims[ClaimsOrgSchemaorg.addressCountry],
          didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: `did:web:${alternateName}`, service: [] },
          meta: { lastUpdated: new Date().toISOString() }
        };
        await this.vaultRepository.createNewVault({ id: alternateName, custodian: newTenantConfig.id });
        await this.vaultRepository.put('host', [newTenantConfig], 'tenants');
    }

    // 3. --- Process Claims into Resources (ALWAYS RUNS) ---
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
      for (const claimName in claims) {
        if (claimName.startsWith(`org.schema.${type}.`)) {
          resourceClaims[claimName] = claims[claimName];
        }
      }
      
      const identifierClaim = claims[`org.schema.${type}.identifier`];
      const resourceId = determineResourceId(identifierClaim, environment);

      includedResources.push({
        type: type,
        id: resourceId,
        meta: { claims: resourceClaims },
      });
    }

    // 4. --- Construct and Return JSON:API Response (ALWAYS RUNS) ---
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
