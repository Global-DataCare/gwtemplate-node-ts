// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EmployeeConfig } from '../models/employee-config';
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
 * This function is now decoupled from the EntityConfig object.
 *
 * @param sector The specific sector of the tenant.
 * @returns An array of `DidService` objects for the tenant's business logic endpoints.
 */
function generateDefaultBusinessServices(sector: Sector): DidService[] {
  const services: DidService[] = [];
  const isFhir = FHIR_SECTORS.includes(sector);

  const entityResources = ['Employee', 'Role', 'Place', 'Organization', 'Bundle'];
  const individualResources = ['Customer', 'RelatedPerson', 'Bundle'];

  if (isFhir) {
    entityResources.push('Practitioner', 'PractitionerRole', 'Location');
    individualResources.push('Patient');
  }

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
 * @param didId The primary DID identifier for the tenant.
 * @param sector The tenant's business sector.
 * @param customServices An optional array of custom service configurations for future extensibility.
 * @returns The complete array of DidService objects for the didDocument.
 */
export function initializeTenantServices(didId: string, sector: Sector, customServices: DidService[] = []): DidService[] {
  const didIdentifier = didId.substring('did:web:'.length);
  const baseUrl = `https://${didIdentifier.replace(/:/g, '/')}`;

  const discoveryServices: DidService[] = [
    {
      id: `${didId}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${baseUrl}/.well-known/did.json`,
    },
    {
      id: `${didId}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${baseUrl}/jwks.json`,
    },
  ];

  const defaultBusinessServices = generateDefaultBusinessServices(sector);

  const allServices = [...discoveryServices, ...defaultBusinessServices, ...customServices];
  const serviceMap = new Map(allServices.map(s => [s.id, s]));
  
  return Array.from(serviceMap.values());
}

/**
 * Generates the specific service list for the Host.
 * @param didId The primary DID identifier for the host.
 * @param sectorsAllowed The list of sectors the host is allowed to manage.
 * @returns The complete array of DidService objects for the host's didDocument.
 */
export function initializeHostServices(didId: string, sectorsAllowed: Sector[]): DidService[] {
  const didIdentifier = didId.substring('did:web:'.length);
  const baseUrl = `https://${didIdentifier.replace(/:/g, '/')}`;

  const services: DidService[] = [
    {
      id: `${didId}#did-document`,
      type: 'LinkedDomains',
      serviceEndpoint: `${baseUrl}/.well-known/did.json`,
    },
    {
      id: `${didId}#jwks`,
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${baseUrl}/jwks.json`,
    },
  ];

  const uniqueSectors = new Set([...(sectorsAllowed || []), Sector.TEST]);
  for (const sector of Array.from(uniqueSectors)) {
    services.push(createDidEndpointConfig(
      createDidServiceId({ version: 'v1', sector, section: 'registry', format: 'org.schema' }),
      ['Organization']
    ));
  }
  return services;
}

/**
 * Initializes the complete service list for a new Employee.
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
  ];

  return services;
}