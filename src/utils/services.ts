// src/utils/services.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DidService, ServiceEndpointSelector } from 'gdc-common-utils-ts/models/did';
import {
  DidServiceIds,
  DidServiceTypes,
} from 'gdc-common-utils-ts/constants/did-services';
import {
  ServiceCapabilityFamily,
  hasServiceCapabilityFamily,
  isProviderServiceCapability,
  parseServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import { isFhirSector, isResearchSector } from './sector';
import {
  ACTION_DISABLE,
  ACTION_ENABLE,
  ACTION_PURGE,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';

export type HostRegistrySector = 'test' | 'test-network' | 'network';

/**
 * Returns whether a service capability claim marks a tenant as provider-capable.
 *
 * This is used by autodiscovery to avoid publishing tenants that can only consume
 * services but cannot act as providers.
 */
export function hasProviderServiceCapabilityClaim(serviceCapabilityClaim?: string): boolean {
  const serviceTypes = parseServiceCapabilityTokens(String(serviceCapabilityClaim || ''));
  return serviceTypes.some((token) => isProviderServiceCapability(token));
}

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
export function resolveHostRegistrySector(input: string | undefined | { nodeEnv?: string; networkMode?: string }): HostRegistrySector {
  if (typeof input === 'object' && input !== null) {
    const networkMode = String(input.networkMode || '').trim().toLowerCase();
    if (networkMode === 'test' || networkMode === 'test-network' || networkMode === 'network') {
      return networkMode as HostRegistrySector;
    }
    const env = String(input.nodeEnv || '').trim().toLowerCase();
    if (env === 'production') return 'network';
    if (env === 'development' || env === 'staging') return 'test-network';
    return 'test';
  }

  const env = String(input || '').trim().toLowerCase();
  if (env === 'production') return 'network';
  if (env === 'development' || env === 'staging') return 'test-network';
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
 * Parses a comma-separated resource list from env and returns normalized FHIR resource names.
 *
 * @example
 * EXT_FHIR_API_BATCH_RESOURCES="Appointment,Task"
 * // => ["Appointment", "Task"]
 */
function parseResourceListFromEnv(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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
  const isFhir = isFhirSector(sector);
  const isResearch = isResearchSector(sector);

  const entityResources = ['Employee', 'EmployeeRole', 'Place', 'Organization', 'Bundle'];
  // NOTE: `Organization`/`Order` under `individual/org.schema` is used for the Family onboarding flow
  // (the "family" is modelled as an Organization representing a household).
  const individualResources = ['Person', 'Organization', 'Order', 'Composition', 'Communication', 'Subscription', 'RelatedPerson', 'Bundle'];

  if (isFhir) {
    entityResources.push('Practitioner', 'PractitionerRole', 'Location');
    individualResources.push('Patient');
  }

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: 'entity', format: 'org.schema' },
    entityResources,
    ['_batch']
  ));

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: 'entity', format: 'org.schema' },
    ['Employee'],
    [ACTION_PURGE]
  ));

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.schema' },
    individualResources,
    ['_batch']
  ));

  services.push(createDidEndpointConfigFromSelector(
    { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.schema' },
    ['Organization'],
    ['_transaction', ACTION_DISABLE, ACTION_PURGE]
  ));

  // Family/onboarding flows query the household organization via org.schema.
  services.push(createDidEndpointConfigFromSelector(
    { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.schema' },
    ['Organization'],
    ['_search']
  ));

  // FHIR endpoints are exposed under explicit FHIR formats (as documented in API_INTEGRATORS_GUIDE and Swagger).
  // Keep them separate from `org.schema` so request validation matches the URL path format segment.
  if (isFhir) {
    const fhirR4CoreBatchResources = [
      'Consent',
      'Communication',
      'Composition',
      'DocumentReference',
      'Patient',
      'AllergyIntolerance',
      'Condition',
      'MedicationStatement',
      'Observation',
      'Procedure',
      'Immunization',
      'DiagnosticReport',
      'CarePlan',
      'Encounter',
      'AdverseEvent',
      'RelatedPerson',
      'Bundle',
    ];
    const fhirApiCoreBatchResources = [
      'Consent',
      'Communication',
      'Composition',
      'DocumentReference',
      'Patient',
      'AllergyIntolerance',
      'Condition',
      'Observation',
      'Procedure',
      'Immunization',
      'DiagnosticReport',
      'CarePlan',
      'Encounter',
      'AdverseEvent',
      'RelatedPerson',
      'MedicationStatement',
      'Bundle',
    ];
    /**
     * Optional non-core FHIR API resources.
     *
     * CORE baseline keeps this empty by default; external deployments can opt-in
     * via env without changing code.
     */
    const fhirApiExtensionBatchResources: string[] = parseResourceListFromEnv(process.env.EXT_FHIR_API_BATCH_RESOURCES);

    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.r4' },
        fhirR4CoreBatchResources,
        ['_batch'],
      ),
    );
    // Personal (non-clinical) data collection endpoints use the versionless `org.hl7.fhir.api` context.
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.api' },
        [...fhirApiCoreBatchResources, ...fhirApiExtensionBatchResources],
        ['_batch'],
      ),
    );
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.api' },
        ['MedicationStatement'],
        ['_search'],
      ),
    );
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.api' },
        ['Composition', 'Bundle'],
        ['_search'],
      ),
    );
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.r4' },
        ['Composition', 'Bundle'],
        ['_search'],
      ),
    );
  }

  // Digital twin ingestion for research sectors uses flat interoperable claims (`org.hl7.fhir.api`)
  // wrapped in Composition resources.
  if (isResearch) {
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'digitaltwin', format: 'org.hl7.fhir.api' },
        ['Composition'],
        ['_batch'],
      ),
    );
    services.push(
      createDidEndpointConfigFromSelector(
        { sector, section: 'digitaltwin', format: 'org.hl7.fhir.r4' },
        ['Composition'],
        ['_batch'],
      ),
    );
  }

  return services;
}

function filterBusinessServicesByCapabilityClaim(
  services: DidService[],
  sector: Sector,
  serviceCapabilityClaim?: string,
): DidService[] {
  const hasExplicitClaim = String(serviceCapabilityClaim || '').trim().length > 0;
  if (!hasExplicitClaim) {
    return services;
  }

  const indexingEnabled = hasServiceCapabilityFamily(serviceCapabilityClaim, ServiceCapabilityFamily.Indexing);
  const digitalTwinEnabled = hasServiceCapabilityFamily(serviceCapabilityClaim, ServiceCapabilityFamily.DigitalTwin);

  return services.filter((service) => {
    const selector = (service as any).selector as ServiceEndpointSelector | undefined;
    if (!selector?.section) {
      return true;
    }

    if (selector.section === 'digitaltwin') {
      return digitalTwinEnabled;
    }

    if (selector.section === 'entity' || selector.section === SUBJECT_SECTION_INDIVIDUAL) {
      return indexingEnabled;
    }

    return true;
  });
}

/**
 * Generates the business logic service CONFIGURATION for a new tenant.
 * This defines the services for `didConfig.service`.
 */
export function initializeTenantServicesConfig(
  sector: Sector,
  customServices: DidService[] = [],
  serviceCapabilityClaim?: string,
): DidService[] {
  const defaultBusinessServices = filterBusinessServicesByCapabilityClaim(
    generateDefaultBusinessServices(sector),
    sector,
    serviceCapabilityClaim,
  );
  
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
    // Device search (admin listing).
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['Device'],
      ['_search'],
    ),
    // SMART token issuance endpoint.
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['smart'],
      ['token'],
    ),
    // License issuance/reservation endpoint (creates an activation code for a specific target user/device).
    // This is used by tenant admins/IT to invite professionals after licenses have been purchased.
    createDidEndpointConfigFromSelector(
      { sector, section: 'identity', format: 'openid' },
      ['License'],
      ['_issue'],
    ),
    // Tenant-level DIDComm messaging (used to deliver ICA status and other async notices to tenant controllers).
    createDidEndpointConfigFromSelector(
      { sector, section: 'messaging', format: 'post-quantum' },
      ['didcomm-plaintext', 'didcomm-signed', 'didcomm-encrypted'],
      ['_send', '_receive', '_messages', '_get', '_delete'],
    ),
  ];

  // DSP/DCP discovery service entries published in the tenant DID document.
  // These are explicit endpoint entries (not selector-multiplexed API templates).
  const defaultDataspaceDiscoveryServices: DidService[] = [
    {
      id: '#dsp-data-service',
      type: 'DataService',
      serviceEndpoint: '/.well-known/dspace-version',
    } as DidService,
    {
      id: '#dsp-catalog-service',
      type: 'CatalogService',
      serviceEndpoint: '/dcat3/catalog/request',
    } as DidService,
    {
      id: '#dcp-issuer-service',
      type: 'IssuerService',
      serviceEndpoint: '/presentations/query',
    } as DidService,
  ];

  const allServices = [
    ...defaultBusinessServices,
    ...defaultNetworkServices,
    ...defaultOidcServices,
    ...defaultDataspaceDiscoveryServices,
    ...customServices,
  ];
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
export function initializeHostServicesConfig(sectorsAllowed: Sector[], nodeEnv: string, networkMode?: string): DidService[] {
  const services: DidService[] = [];
  const hostRegistrySector = resolveHostRegistrySector({ nodeEnv, networkMode });

  // Host onboarding (Organization registration + Order) is exposed under a "network env sector".
  services.push(
    createDidEndpointConfigFromSelector(
      { sector: hostRegistrySector as any, section: 'registry', format: 'org.schema' },
      ['Organization'],
      ['_batch', '_activate', ACTION_DISABLE, ACTION_ENABLE],
    ),
  );
  services.push(
    createDidEndpointConfigFromSelector(
      { sector: hostRegistrySector as any, section: 'registry', format: 'org.schema' },
      ['Order'],
      ['_batch'],
    ),
  );

  // ICA enrollment endpoint (system + test-network).
  services.push(
    createDidEndpointConfigFromSelector(
      { sector: Sector.SYSTEM as any, section: 'test-network', format: 'ica' },
      ['csr'],
      ['_enroll'],
    ),
  );

  // DIDComm messaging (general, non-FHIR)
  services.push(
    createDidEndpointConfigFromSelector(
      { sector: Sector.SYSTEM as any, section: 'messaging', format: 'post-quantum' },
      ['didcomm-plaintext', 'didcomm-signed', 'didcomm-encrypted'],
      ['_send', '_receive', '_messages', '_get', '_delete'],
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

  /**
   * Optional host-level extension resources for local/demo environments.
   *
   * This keeps CORE neutral: nothing is exposed unless explicitly enabled.
   */
  const hostExtensionResources = parseResourceListFromEnv(process.env.EXT_HOST_FHIR_API_RESOURCES);
  if (hostExtensionResources.length > 0) {
    services.push(
      createDidEndpointConfigFromSelector(
        { sector: Sector.TEST as any, section: SUBJECT_SECTION_INDIVIDUAL, format: 'org.hl7.fhir.api' },
        hostExtensionResources,
        ['_batch', '_search'],
      ),
    );
  }

  // DSP/DCP discovery entries for operator/host DID.
  services.push(
    {
      id: '#dsp-data-service',
      type: 'DataService',
      serviceEndpoint: '/.well-known/dspace-version',
    } as DidService,
    {
      id: DidServiceIds.Catalog,
      type: DidServiceTypes.CatalogService,
      serviceEndpoint: '/.well-known/dcat3/catalog',
    } as DidService,
    {
      id: '#dcp-issuer-service',
      type: 'IssuerService',
      serviceEndpoint: '/presentations/query',
    } as DidService,
  );
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

  const isFhir = isFhirSector(sector);
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
