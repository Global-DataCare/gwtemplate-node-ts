// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidService } from '../models/did';
import { TenantConfig } from '../models/tenant';
import { createDidServiceId } from './did';

// As per SYSTEM_DESIGN.md, these sectors are FHIR-enabled.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

/**
 * (Internal) Creates a standardized DID Service Endpoint configuration object.
 */
const createDidEndpointConfig = (id: string, resources: string[], actions: string[] = ['_batch']): DidService => {
  const serviceEndpoint = resources.join(',');
  return { id, type: 'ApiService', serviceEndpoint, actions };
};

/**
 * (Internal) Generates the default set of BUSINESS LOGIC service endpoints for a new tenant.
 */
function generateDefaultBusinessServices(tenantConfig: TenantConfig): DidService[] {
  const { sector } = tenantConfig;
  const services: DidService[] = [];
  const isFhir = FHIR_SECTORS.includes(sector);

  const entityResources = isFhir
    ? ['Practitioner', 'PractitionerRole', 'Location', 'Organization', 'Bundle']
    : ['Employee', 'Role', 'Place', 'Organization', 'Bundle'];
  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'entity', format: 'jsonapi' }),
    entityResources
  ));

  const individualResources = isFhir
    ? ['Patient', 'RelatedPerson', 'Bundle']
    : ['Customer', 'RelatedPerson', 'Bundle'];
  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'profile', format: 'jsonapi' }),
    individualResources
  ));

  return services;
}

/**
 * Initializes the complete service list for a Tenant by combining discovery,
 * default business services, and any custom-provided services.
 * This is the primary function to be used by managers.
 * @param tenantConfig The configuration of the new tenant.
 * @param customServices An optional array of custom service configurations.
 * @returns The complete array of DidService objects for the didDocument.
 */
export function initializeTenantServices(tenantConfig: TenantConfig, customServices: DidService[] = []): DidService[] {
  const { didDocument } = tenantConfig;
  const baseUrl = didDocument.id.replace('did:web:', 'https://').replace(/:/g, '/');

  const discoveryServices: DidService[] = [
    {
      id: `${didDocument.id}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${baseUrl}/.well-known/did.json`,
    },
    {
      id: `${didDocument.id}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${baseUrl}/jwks.json`,
    },
  ];

  const defaultBusinessServices = generateDefaultBusinessServices(tenantConfig);

  // Combine all services, ensuring no duplicates by ID.
  const allServices = [...discoveryServices, ...defaultBusinessServices, ...customServices];
  const serviceMap = new Map(allServices.map(s => [s.id, s]));
  
  return Array.from(serviceMap.values());
}

/**
 * Generates the specific service list for the Host, which only includes
 * discovery and registry endpoints.
 * @param hostConfig The configuration of the host tenant.
 * @returns The complete array of DidService objects for the host's didDocument.
 */
export function initializeHostServices(hostConfig: TenantConfig): DidService[] {
  const { didDocument, sectorsAllowed } = hostConfig;
  const baseUrl = didDocument.id.replace('did:web:', 'https://').replace(/:/g, '/');

  const services: DidService[] = [
    {
      id: `${didDocument.id}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${baseUrl}/.well-known/did.json`,
    },
    {
      id: `${didDocument.id}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${baseUrl}/jwks.json`,
    },
  ];

  // The host must have a registry service for EACH sector it is allowed to manage.
  const allowedSectors = [...(sectorsAllowed || []), 'test']; // 'test' is always allowed
  for (const sector of new Set(allowedSectors)) {
    services.push(createDidEndpointConfig(
      createDidServiceId({ version: 'v1', sector, section: 'registry', format: 'org.schema' }),
      ['Organization']
    ));
  }
  return services;
}