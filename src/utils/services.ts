// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../models/entity';
import { Sector } from '../models/urlPath';
import { DidService } from '../models/did';
import { createDidServiceIdBase } from './did';

// As per SYSTEM_DESIGN.md, these sectors are FHIR-enabled.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

/**
 * (Internal) Creates a standardized DID Service Endpoint configuration object.
 * This represents the LOGICAL configuration of a service.
 */
const createDidEndpointConfig = (id: string, resources: string[], actions: string[]): DidService => {
  const serviceEndpoint = resources.join(',');
  return { id, type: 'ApiService', serviceEndpoint, actions };
};

/**
 * (Internal) Generates the default set of BUSINESS LOGIC service endpoints for a new tenant.
 *
 * @architecture
 * The resource type names (e.g., 'Employee', 'Patient') use PascalCase because they
 * directly correspond to the resource names defined in their source schemas
 * (Schema.org and HL7 FHIR, respectively). The API router's validation logic
 * handles this by performing a case-insensitive comparison.
 */
function generateDefaultBusinessServices(sector: Sector): DidService[] {
  const services: DidService[] = [];
  const isFhir = FHIR_SECTORS.includes(sector);

  const entityResources = ['Employee', 'EmployeeRole', 'Place', 'Organization', 'Bundle'];
  // NOTE: `Organization`/`Order` under `individual/org.schema` is used for the Family onboarding flow
  // (the "family" is modelled as an Organization representing a household).
  const individualResources = ['Person', 'Organization', 'Order', 'Composition', 'Communication', 'Subscription', 'RelatedPerson', 'Bundle'];

  if (isFhir) {
    entityResources.push('Practitioner', 'PractitionerRole', 'Location');
    individualResources.push('Patient', 'Appointment');
  }

  services.push(createDidEndpointConfig(
    createDidServiceIdBase({ version: 'v1', sector, section: 'entity', format: 'org.schema' }),
    entityResources,
    ['_batch']
  ));

  services.push(createDidEndpointConfig(
    createDidServiceIdBase({ version: 'v1', sector, section: 'individual', format: 'org.schema' }),
    individualResources,
    ['_batch']
  ));

  return services;
}

/**
 * Generates the business logic service CONFIGURATION for a new tenant.
 * This defines the services for `didConfig.service`.
 */
export function initializeTenantServicesConfig(sector: Sector, customServices: DidService[] = []): DidService[] {
  const defaultBusinessServices = generateDefaultBusinessServices(sector);
  
  const defaultNetworkServices: DidService[] = [
      {
          ...(createDidEndpointConfig(
              createDidServiceIdBase({ version: 'v1', sector, section: 'test-network', format: 'org.schema', resourceType: 'Action' }),
              ['Action'],
              ['_batch']
          )),
          type: 'NetworkEnrollmentService'
      },
      {
          ...(createDidEndpointConfig(
              createDidServiceIdBase({ version: 'v1', sector, section: 'test-network', format: 'org.schema', resourceType: 'Person' }),
              ['Person'],
              ['_discovery']
          )),
          type: 'PersonDiscoveryService'
      },
  ];

  const defaultOidcServices: DidService[] = [
    createDidEndpointConfig(
      // 1. The BASE ID defines the group, without a resource.
      createDidServiceIdBase({ version: 'v1', sector, section: 'identity', format: 'openid' }),
      // 2. The RESOURCES to be multiplexed.
      ['Device'],
      // 3. The ACTIONS to be multiplexed.
      ['_dcr']
    ),
  ];

  const allServices = [...defaultBusinessServices, ...defaultNetworkServices, ...defaultOidcServices, ...customServices];
  const serviceMap = new Map(allServices.map(s => [s.id, s]));
  return Array.from(serviceMap.values());
}

/**
 * Generates the business logic service CONFIGURATION for the Host.
 * This defines the services for `didConfig.service`.
 */
export function initializeHostServicesConfig(sectorsAllowed: Sector[]): DidService[] {
  const services: DidService[] = [];
  const uniqueSectors = new Set([...(sectorsAllowed || []), Sector.TEST]);

  for (const sector of Array.from(uniqueSectors)) {
    if (sector === Sector.SYSTEM) {
      continue;
    }
    services.push(createDidEndpointConfig(
      createDidServiceIdBase({ version: 'v1', sector, section: 'registry', format: 'org.schema' }),
      ['Organization', 'Order'],
      ['_batch']
    ));
  }
  return services;
}

/**
 * Initializes the complete service list for a new Employee.
 * @param employeeConfig The configuration object for the new employee.
 * @returns The array of DidService objects for the employee's didDocument.
 */
export function initializeEmployeeServices(employeeConfig: EntityConfig, tenantClaims: any): DidService[] {
  const { didDocument } = employeeConfig;
  if (!didDocument?.id) {
    throw new TypeError("Cannot initialize employee services: didDocument with id is missing from the configuration.");
  }
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
export function initializeCustomerServices(customerConfig: EntityConfig, sector: Sector, tenantClaims: any): DidService[] {
  const { didDocument } = customerConfig;
  if (!didDocument?.id) {
    throw new TypeError("Cannot initialize customer services: didDocument with id is missing from the configuration.");
  }
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

  const isFhir = FHIR_SECTORS.includes(sector);
  const individualResources = ['Customer', 'RelatedPerson', 'Bundle', 'Person'];
  if (isFhir) {
    individualResources.push('Patient');
  }

  const format = isFhir ? 'org.hl7.fhir.api' : 'org.schema';
  const section = 'index';

  const businessService = createDidEndpointConfig(
    createDidServiceIdBase({ version: 'v1', sector, section, format }),
    individualResources,
    ['_batch']
  );

  return [...coreServices, businessService];
}
