// src/utils/did-document.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidService } from '../models/did';

/**
 * Creates the standard, public-facing "well-known" service endpoints for a DID Document.
 * These are essential for standard DID resolution and discovery.
 */
function createWellKnownDidServices(did: string, baseUrl: string): DidService[] {
  // The final base URL for well-known services should not have a trailing slash.
  const finalBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return [
    {
      id: `${did}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${finalBaseUrl}/.well-known/did.json`,
    },
    {
      id: `${did}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${finalBaseUrl}/jwks.json`,
    },
  ];
}

/**
 * Assembles the final `service` array for a public DID Document by "multiplexing"
 * the internal service configuration into multiple, discrete public endpoints.
 *
 * This function takes logical service definitions from `didConfig.service` and expands them
 * into an array of specific, invokable service endpoints for the public DID Document,
 * correctly constructing the URL based on whether the tenant is hosted or has its own domain.
 *
 * @param {string} did The canonical DID of the entity.
 * @param {string} baseUrl The authoritative base URL (e.g., `https://gateway.com` or `https://api.acme.com`).
 * @param {DidService[]} businessServicesConfig The array of logical business services from `didConfig.service`.
 * @param {boolean} isHosted A flag indicating if the tenant's endpoints are hosted on the gateway.
 * @param {object} tenantContext Contains path components (`alternateName`, `jurisdiction`, etc.) for hosted tenants.
 * @returns {DidService[]} A complete and merged array of `DidService` objects for the public `didDocument`.
 */
export function populateDidDocumentServices(
  did: string,
  baseUrl: string,
  businessServicesConfig: DidService[],
  isHosted: boolean,
  tenantContext: { alternateName: string; jurisdiction: string; version: string; sector: string; }
): DidService[] {
  
  // For hosted tenants, the well-known endpoints are at the root of their full contextual path.
  // For own-domain tenants, they are at the root of their domain.
  const wellKnownBaseUrl = isHosted
    ? `${baseUrl}/${tenantContext.alternateName}/cds-${tenantContext.jurisdiction}/${tenantContext.version}/${tenantContext.sector}`
    : baseUrl;

  // 1. Create the standard, W3C-compliant well-known services.
  const wellKnownServices = createWellKnownDidServices(did, wellKnownBaseUrl);

  // 2. Multiplex the internal business service templates into discrete, public service endpoints.
  const populatedBusinessServices: DidService[] = businessServicesConfig.flatMap(configService => {
    const resourceTypes = (configService.serviceEndpoint as string).split(',');
    const actions = configService.actions || [];
    const pathParts = configService.id.split(':'); // e.g., [v1, health-care, entity, org.schema]
    const section = pathParts[2];
    const format = pathParts[3]; // Format now contains dots directly.
    
    // This is the core multiplexing logic.
    return resourceTypes.flatMap(resourceType => {
      return actions.map((action: string) => {
        // Create the new, granular, public-facing service ID using the full context.
        // The final service ID fragment MUST be lowercased for consistency.
        const serviceId = `${configService.id}:${resourceType.trim().toLowerCase()}:${action.toLowerCase()}`;
        const functionalPath = `${section}/${format}/${resourceType.trim()}/${action}`;

        let serviceEndpointUrl: string;
        if (isHosted) {
          // A hosted tenant's URL is fully contextual.
          const contextualPath = `${tenantContext.alternateName}/cds-${tenantContext.jurisdiction}/${tenantContext.version}/${tenantContext.sector}`;
          serviceEndpointUrl = `${baseUrl}/${contextualPath}/${functionalPath}`;
        } else {
          // An own-domain tenant's URL is simple and functional.
          serviceEndpointUrl = `${baseUrl}/${functionalPath}`;
        }

        // Return the final, public service object.
        return {
          id: `${did}#${serviceId}`,
          type: configService.type,
          serviceEndpoint: serviceEndpointUrl,
        };
      });
    });
  });

  // 3. Combine the well-known services with all the new, populated business services.
  return [...wellKnownServices, ...populatedBusinessServices];
}
