// src/__tests__/unit/utils/services.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../../../utils/services';
import { OrganizationConfig } from '../../../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IServerConfig } from '../../../config';
import { DidService } from 'gdc-common-utils-ts/models/did';
import {
  ServiceCapabilityToken,
  serializeServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';

// Create a mock config object for the tests.
const mockConfig: IServerConfig = {
  hostExternalDomain: 'host.example.com',
} as IServerConfig; // Cast to avoid filling out all properties

// Helper factory function to create tenant configurations for tests, reducing repetition.
const createTestTenantConfig = (
  sector: Sector,
  didId: string,
  sectorsAllowed: Sector[] = []
): OrganizationConfig => {
  const result: OrganizationConfig = {
    id: 'urn:uuid:tenant-uuid',
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    networkStatus: [],
    meta: { lastUpdated: '' },
    claims: {
      alternateName: 'acme',
      legalName: 'ACME Inc.',
      addressCountry: 'ES',
      url: 'https://acme.com',
    },
    didConfig: { service: [] },
    didDocument: {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: didId,
      service: [],
    },
    provider: {
      service: {
        sectorCategory: sector,
        sectorsAllowed: sectorsAllowed,
      }
    }
  };
  return result;
};

describe('Service Initialization Utilities', () => {

  describe('initializeTenantServicesConfig', () => {
    
    it('should create default entity and individual services for a non-FHIR tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.RESEARCH, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);

      // ASSERT
      expect(services.length).toBeGreaterThanOrEqual(16);

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).not.toContain('Practitioner');

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).not.toContain('Patient');

      const digitalTwinService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api',
      );
      expect(digitalTwinService).toBeDefined();
      expect(digitalTwinService!.serviceEndpoint).toContain('Composition');

      const digitalTwinR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(digitalTwinR4Service).toBeDefined();
      expect(digitalTwinR4Service!.serviceEndpoint).toContain('Composition');

      const messagingService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'messaging' &&
          (s as any).selector?.format === 'post-quantum',
      );
      expect(messagingService).toBeDefined();
      expect(messagingService!.serviceEndpoint).toContain('didcomm-plaintext');

      const dataService = services.find((s: DidService) => s.type === 'DataService');
      const catalogService = services.find((s: DidService) => s.type === 'CatalogService');
      const issuerService = services.find((s: DidService) => s.type === 'IssuerService');
      expect(dataService).toBeDefined();
      expect(catalogService).toBeDefined();
      expect(issuerService).toBeDefined();
    });

    it('should ADD FHIR resources for a FHIR-enabled tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.HEALTH_CARE, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);
      
      // ASSERT
      expect(services.length).toBeGreaterThanOrEqual(16);

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).toContain('Practitioner');

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).toContain('Patient');

      const individualTransactionService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Organization' &&
          (s.actions || []).includes('_transaction'),
      );
      expect(individualTransactionService).toBeDefined();
      expect(individualTransactionService?.actions).toContain('_disable');
      expect(individualTransactionService?.actions).toContain('_purge');

      const employeePurgeService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'entity' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Employee' &&
          (s.actions || []).includes('_purge'),
      );
      expect(employeePurgeService).toBeDefined();

      const fhirR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(fhirR4Service).toBeDefined();
      expect(fhirR4Service!.serviceEndpoint).toContain('DocumentReference');
      expect(fhirR4Service!.serviceEndpoint).toContain('Observation');

      const fhirApiService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.api',
      );
      expect(fhirApiService).toBeDefined();
      expect(fhirApiService!.serviceEndpoint).toContain('Consent');
      expect(fhirApiService!.serviceEndpoint).toContain('DocumentReference');
    });

    it('should treat synthetic animal-tech as FHIR-enabled', () => {
      const services = initializeTenantServicesConfig('animal-tech' as Sector);

      expect(services.length).toBeGreaterThanOrEqual(16);

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Patient');

      const fhirR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(fhirR4Service).toBeDefined();
    });

    it('should expose digital twin ingestion for synthetic animal-research', () => {
      const services = initializeTenantServicesConfig('animal-research' as Sector);

      const digitalTwinService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api',
      );

      expect(digitalTwinService).toBeDefined();
      expect(digitalTwinService!.serviceEndpoint).toContain('Composition');
      expect(digitalTwinService!.actions).toEqual(['_batch']);

      const digitalTwinR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(digitalTwinR4Service).toBeDefined();
      expect(digitalTwinR4Service!.serviceEndpoint).toContain('Composition');
      expect(digitalTwinR4Service!.actions).toEqual(['_batch']);
    });

    it('should filter tenant discovery endpoints to indexing-only capabilities when serviceType excludes digital twin', () => {
      const services = initializeTenantServicesConfig(
        Sector.RESEARCH,
        [],
        serializeServiceCapabilityTokens([ServiceCapabilityToken.IndexReader]),
      );

      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'entity',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'individual',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'digitaltwin',
      )).toBe(false);
    });

    it('should filter tenant discovery endpoints to digital twin-only capabilities when serviceType excludes indexing', () => {
      const services = initializeTenantServicesConfig(
        Sector.RESEARCH,
        [],
        serializeServiceCapabilityTokens([ServiceCapabilityToken.DigitalTwinReader]),
      );

      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'entity',
      )).toBe(false);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'individual',
      )).toBe(false);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'digitaltwin',
      )).toBe(true);
    });

    it('should not include standard discovery endpoints', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.RESEARCH, 'did:web:acme.com');

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);

      // ASSERT
      const didDocService = services.find((s: DidService) => s.id.endsWith('#did-document'));
      expect(didDocService).toBeUndefined();

      const jwksService = services.find((s: DidService) => s.id.endsWith('#jwks'));
      expect(jwksService).toBeUndefined();
    });
  });

  describe('initializeHostServicesConfig', () => {
    it('should create a single registry service for the host (network env sector) and identity services per business sector', () => {
      // ARRANGE
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, `did:web:${mockConfig.hostExternalDomain}`, [Sector.RESEARCH, Sector.HEALTH_CARE]);
      if (hostConfig.claims) {
        (hostConfig.claims as any).alternateName = 'host'; // Override for host specific test
      }

      // ACT
      const services = initializeHostServicesConfig(hostConfig.provider!.service.sectorsAllowed as Sector[], 'test');

      // ASSERT
      const registryServices = services.filter((s: DidService) => (s as any).selector?.section === 'registry');
      expect(registryServices).toHaveLength(2);
      const organizationRegistry = registryServices.find((s: DidService) => s.serviceEndpoint === 'Organization');
      const orderRegistry = registryServices.find((s: DidService) => s.serviceEndpoint === 'Order');
      expect((organizationRegistry as any)?.selector?.sector).toBe('test');
      expect(organizationRegistry?.actions).toEqual(['_batch', '_activate', '_disable', '_enable']);
      expect(orderRegistry?.actions).toEqual(['_batch']);

      const identityServices = services.filter((s: DidService) => (s as any).selector?.section === 'identity');
      expect(identityServices).toHaveLength(4); // (research + health-care) × (firebase + openid)
    });

    it('should allow explicit NETWORK_MODE override independently of NODE_ENV', () => {
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, 'did:web:host.example.com', [Sector.RESEARCH]);
      const services = initializeHostServicesConfig(
        hostConfig.provider!.service.sectorsAllowed as Sector[],
        'production',
        'test-network',
      );

      const registryServices = services.filter((s: DidService) => (s as any).selector?.section === 'registry');
      expect(registryServices).toHaveLength(2);
      expect((registryServices[0] as any).selector?.sector).toBe('test-network');
      expect((registryServices[1] as any).selector?.sector).toBe('test-network');
    });
  });
});
