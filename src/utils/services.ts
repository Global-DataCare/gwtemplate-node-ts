// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EmployeeConfig } from '../models/employee-config';
import { TenantConfig } from '../models/tenant';
import { Sector } from '../models/sector';
import { DidService } from '../models/did';
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
 * Generates the default set of BUSINESS LOGIC service endpoints for a new tenant.
 * This is the central function to modify when adding new default resource endpoints to the system.
 *
 * The logic is as follows:
 * 1. A base set of resources for entity management (Employee, Role, etc.) is ALWAYS included for ALL tenants.
 * 2. The system then checks the tenant's `sector`.
 * 3. If the sector has sector-specific resources (e.g., 'health-care' for FHIR), those resources are ADDED to the base list.
 *    The base resources are NOT replaced.
 *
 * @param tenantConfig The configuration of the tenant, containing the `sector`.
 * @returns An array of `DidService` objects for the tenant's business logic endpoints.
 */
function generateDefaultBusinessServices(tenantConfig: TenantConfig): DidService[] {
  const { sector } = tenantConfig;
  const services: DidService[] = [];
  const isFhir = FHIR_SECTORS.includes(sector);

  // 1. Define the base resources available to ALL tenants.
  const entityResources = ['Employee', 'Role', 'Place', 'Organization', 'Bundle'];
  const individualResources = ['Customer', 'RelatedPerson', 'Bundle'];

  // 2. If the tenant is in a FHIR-enabled sector, ADD sector-specific resources.
  if (isFhir) {
    entityResources.push('Practitioner', 'PractitionerRole', 'Location');
    individualResources.push('Patient');
  }

  // 3. Create the service endpoints with the final resource lists.
  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'entity', format: 'org.schema' }),
    entityResources
  ));

  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'profile', format: 'org.schema' }),
    individualResources
  ));

  return services;
}

/**
 * Initializes the complete service list for a Tenant by combining discovery,
 * default business services, and any custom-provided services.
 * @param tenantConfig The configuration of the new tenant.
 * @param customServices An optional array of custom service configurations for future extensibility.
 * @returns The complete array of DidService objects for the didDocument.
 */
export function initializeTenantServices(tenantConfig: TenantConfig, customServices: DidService[] = []): DidService[] {
  const { didConfig: didDocument } = tenantConfig;
  // Robustly parse the DID to get the base URL, preventing replace errors.
  const didIdentifier = didDocument.id.substring('did:web:'.length);
  const baseUrl = `https://${didIdentifier.replace(/:/g, '/')}`;

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
  const { didConfig: didDocument, sectorsAllowed } = hostConfig;
  const didIdentifier = didDocument.id.substring('did:web:'.length);
  const baseUrl = `https://${didIdentifier.replace(/:/g, '/')}`;

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
  // Use a Set to automatically handle duplicates (e.g., if 'test' is already in sectorsAllowed).
  const uniqueSectors = new Set([...(sectorsAllowed || []), Sector.TEST]);
  for (const sector of uniqueSectors) {
    services.push(createDidEndpointConfig(
      createDidServiceId({ version: 'v1', sector, section: 'registry', format: 'org.schema' }),
      ['Organization']
    ));
  }
  return services;
}

/**
 * Initializes the complete service list for a new Employee.
 * An employee's DID is simpler and primarily points to discovery endpoints.
 * @param employeeConfig The configuration object for the new employee.
 * @returns The array of DidService objects for the employee's didDocument.
 */
export function initializeEmployeeServices(employeeConfig: EmployeeConfig): DidService[] {
  const { didDocument } = employeeConfig;
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
    // Future services for an employee could be added here,
    // e.g., credential presentation endpoints.
  ];

  return services;
}
