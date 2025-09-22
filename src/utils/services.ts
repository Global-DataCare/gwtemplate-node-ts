// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantConfig } from '../models/tenant';
import { DidServiceEndpoint } from '../models/did';

// As per SYSTEM_DESIGN.md, these sectors are FHIR-enabled.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

// Helper to create a standard ApiService definition.
const createApiService = (id: string, resources: string[]): DidServiceEndpoint => {
  // The serviceEndpoint lists all ResourceTypes allowed for this service definition.
  const serviceEndpoint = resources.join(',');
  return {
    id,
    type: 'ApiService',
    serviceEndpoint,
    actions: ['_batch'], // At present, only _batch is supported.
  };
};

/**
 * Generates the default set of service endpoints for a new tenant based on their sector.
 * This ensures tenants are immediately functional for their domain.
 * @param tenantConfig The configuration of the new tenant.
 * @returns An array of DidService objects to be included in the tenant's didDocument.
 */
export function generateDefaultServicesForTenant(tenantConfig: TenantConfig): DidServiceEndpoint[] {
  const services: DidServiceEndpoint[] = [];
  const { sector } = tenantConfig;

  // 1. Universal Service: Ping (useful for diagnostics)
  services.push(createApiService('#ping', ['resource']));

  // 2. Sector-Specific Services
  const isFhir = FHIR_SECTORS.includes(sector);

  // 2a. Entity Management Services (internal resources)
  const entityResources = isFhir
    ? ['Practitioner', 'PractitionerRole', 'Location', 'Organization', 'Bundle']
    : ['Employee', 'Role', 'Place', 'Organization', 'Bundle'];
  services.push(createApiService('#entity-management', entityResources));

  // 2b. Individual/Patient/Customer Interaction Services
  const individualResources = isFhir
    ? ['Patient', 'RelatedPerson', 'Bundle']
    : ['Customer', 'RelatedPerson', 'Bundle'];
  services.push(createApiService('#individual-interaction', individualResources));

  // (Future) Add other services like 'index' for health-care here.

  return services;
}
