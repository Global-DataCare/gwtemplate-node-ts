// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DidService, ServiceEndpointSelector } from 'gdc-common-utils-ts/models/did';

// As per SYSTEM_DESIGN.md, these sectors are FHIR-enabled.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

export type HostRegistrySector = 'test' | 'test-network' | 'network';

/**
 * Resolves which host "registry sector" to use based on runtime environment.
 *
 * @architecture
 * The host onboarding endpoints are special: the `sector` segment represents the network
 * environment, not the business sector.
 *
 * - `demo`/`test` -> `test` (no blockchain integration; in-memory demo/MVP)
 * - `development`/`staging` -> `test-network` (Hyperledger Fabric test network)
 * - `production` -> `network` (Hyperledger Fabric production network)
 */
export function resolveHostRegistrySector(nodeEnv: string | undefined): HostRegistrySector {
  const env = String(nodeEnv || '').trim().toLowerCase();
  if (env === 'production') return 'network';
  if (env === 'development' || env === 'staging') return 'test-network';
  // Jest sets NODE_ENV=test; demo mode is explicitly NODE_ENV=demo.
  return 'test';
}

/**
 * (Internal) Creates a standardized DID Service Endpoint configuration object.
 * This represents the LOGICAL configuration of a service.
 */
const createDidEndpointConfig = (id: string, resources: string[], actions: string[]): DidService => {
  const serviceEndpoint = resources.join(',');
  return { id, type: 'ApiService', serviceEndpoint, actions };
};

const createDidEndpointConfigFromSelector = (
  selector: Pick<ServiceEndpointSelector, 'section' | 'format'> & Partial<Pick<ServiceEndpointSelector, 'sector'>>,
  resources: string[],
  actions: string[],
  type: DidService['type'] = 'ApiService',
): DidService => {
  const serviceEndpoint = resources.join(',');
  // Internal identifier (not a DID URI). Public `didDocument.service[].id` is derived separately.
  return { id: `#${selector.section}:${selector.format}`, type, serviceEndpoint, actions, selector };
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

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: 'entity', format: 'org.schema' },
    entityResources,
    ['_batch']
  ));

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: 'individual', format: 'org.schema' },
    individualResources,
    ['_batch']
  ));

  // FHIR endpoints are exposed under explicit FHIR formats (as documented in API_INTEGRATORS_GUIDE and Swagger).
  // Keep them separate from `org.schema` so request validation matches the URL path format segment.
  if (isFhir) {
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'individual', format: 'org.hl7.fhir.r4' },
        ['Consent', 'Communication', 'Composition', 'RelatedPerson', 'Bundle'],
        ['_batch'],
      ),
    );
    // Personal (non-clinical) data collection endpoints use the versionless `org.hl7.fhir.api` context.
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'individual', format: 'org.hl7.fhir.api' },
        ['Observation', 'RelatedPerson'],
        ['_batch'],
      ),
    );
  }

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
          ...(createDidEndpointConfigFromSelector(
              { sector, section: 'test-network', format: 'org.schema' },
              ['Action'],
              ['_batch']
          )),
          type: 'NetworkEnrollmentService'
      },
      {
          ...(createDidEndpointConfigFromSelector(
              { sector, section: 'test-network', format: 'org.schema' },
              ['Person'],
              ['_discovery']
          )),
          type: 'PersonDiscoveryService'
      },
  ];

  const defaultOidcServices: DidService[] = [
    // Provider federation: external OIDC -> Firebase custom token.
    // (Used to normalize identity to Firebase before any other protected step.)
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'firebase' },
      ['Token'],
      ['_custom'],
    ),
    // Initial access token exchange for DCR (requires a Firebase id_token + activation_code).
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['Token'],
      ['_exchange'],
    ),
    // Device registration (DCR) endpoint.
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['Device'],
      ['_dcr'],
    ),
    // SMART token issuance endpoint.
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['smart'],
      ['token'],
    ),
  ];

  const allServices = [...defaultBusinessServices, ...defaultNetworkServices, ...defaultOidcServices, ...customServices];
  const serviceMap = new Map<string, DidService>();
  for (const service of allServices) {
    const selectorSector = ((service as any).selector as { sector?: string } | undefined)?.sector || '';
    const key = `${service.id}|${selectorSector}|${service.type}|${service.serviceEndpoint}|${(service.actions || []).join(',')}`;
    serviceMap.set(key, service);
  }
  return Array.from(serviceMap.values());
}

/**
 * Generates the business logic service CONFIGURATION for the Host.
 * This defines the services for `didConfig.service`.
 */
export function initializeHostServicesConfig(sectorsAllowed: Sector[], nodeEnv: string): DidService[] {
  const services: DidService[] = [];
  const hostRegistrySector = resolveHostRegistrySector(nodeEnv);

  // Host onboarding (Organization registration + Order) is exposed under a "network env sector".
  services.push(
    createDidEndpointConfigFromSelector(
      { sector: hostRegistrySector as any, section: 'registry', format: 'org.schema' },
      ['Organization', 'Order'],
      ['_batch'],
    ),
  );

  // Identity endpoints also exist at the host level (onboarding convenience), but these remain
  // business-sector specific because they are consumed by tenants/apps in that sector.
  const uniqueBusinessSectors = new Set([...(sectorsAllowed || [])]);
  for (const sector of Array.from(uniqueBusinessSectors)) {
    if (sector === Sector.SYSTEM || sector === Sector.TEST) continue;
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'identity', format: 'firebase' },
        ['Token'],
        ['_custom'],
      ),
    );
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'identity', format: 'openid' },
        ['Token'],
        ['_exchange'],
      ),
    );
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

  const businessService = createDidEndpointConfigFromSelector(
    { section, format },
    individualResources,
    ['_batch'],
  );

  return [...coreServices, businessService];
}
