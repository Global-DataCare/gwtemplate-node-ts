// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../models/entity';
import { Sector } from '../models/path';
import { DidService } from '../models/did';
import { createDidServiceId } from './did';

// As per SYSTEM_DESIGN.md, these sectors are FHIR-enabled.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

/**
 * (Internal) Creates a standardized DID Service Endpoint configuration object.
 */
const createDidEndpointConfig = (id: string, resources: string[], actions: string[] = ['_create', '_batch']): DidService => {
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

  const entityResources = ['Employee', 'EmployeeRole', 'Place', 'Organization', 'Bundle'];
  // Define the full list of individual-related resources for our roadmap.
  const individualResources = ['Person', 'Composition', 'Communication', 'Subscription', 'RelatedPerson', 'Bundle'];

  if (isFhir) {
    entityResources.push('Practitioner', 'PractitionerRole', 'Location');
    individualResources.push('Patient', 'Appointment'); // Add Appointment for FHIR context
  }

  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'entity', format: 'org.schema' }),
    entityResources
  ));

  // This single service definition now enables all planned individual-related endpoints.
  services.push(createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section: 'individual', format: 'org.schema' }),
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

  // NOTE: In a real implementation, these network services would likely be added to a tenant's
  // DID Document *after* they have successfully enrolled, not by default.
  // They are included here by default to simplify the end-to-end testing flow.
  const defaultNetworkServices: DidService[] = [
    {
      ...(createDidEndpointConfig(
        createDidServiceId({ version: 'v1', sector, section: 'test-network', format: 'org.schema' }),
        ['Action'],
        ['_batch']
      )),
      type: 'NetworkEnrollmentService'
    },
    {
      ...(createDidEndpointConfig(
        createDidServiceId({ version: 'v1', sector, section: 'discovery-network', format: 'org.schema' }),
        ['Person'],
        ['_discovery']
      )),
      type: 'PersonDiscoveryService'
    },
  ];



  const allServices = [...discoveryServices, ...defaultBusinessServices, ...defaultNetworkServices, ...customServices];
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
export function initializeEmployeeServices(employeeConfig: EntityConfig): DidService[] {
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

/**
 * Initializes the complete service list for a new Customer.
 * @param customerConfig The configuration object for the new customer.
 * @param sector The sector of the tenant under which the customer is being created.
 * @returns The array of DidService objects for the customer's didDocument.
 */
export function initializeCustomerServices(customerConfig: EntityConfig, sector: Sector): DidService[] {
  const { didDocument } = customerConfig;
  const baseUrl = didDocument.id.replace('did:web:', 'https://').replace(/:/g, '/');

  const coreServices: DidService[] = [
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

  // Define business services for an individual/customer based on new requirements.
  const isFhir = FHIR_SECTORS.includes(sector);
  const individualResources = ['Customer', 'RelatedPerson', 'Bundle', 'Person'];
  if (isFhir) {
    individualResources.push('Patient');
  }

  const format = isFhir ? 'org.hl7.fhir.api' : 'org.schema';
  const section = 'index'; // Section is 'index' for customer sectorial data index.

  const businessService = createDidEndpointConfig(
    createDidServiceId({ version: 'v1', sector, section, format }),
    individualResources
  );

  return [...coreServices, businessService];
}
