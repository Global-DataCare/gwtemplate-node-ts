// src/__tests__/unit/utils/services.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../../../utils/services';
import { EntityConfig } from '../../../models/entity';
import { Sector } from '../../../models/urlPath';
import { IServerConfig } from '../../../config';
import { DidService } from '../../../models/did';

// Create a mock config object for the tests.
const mockConfig: IServerConfig = {
  hostExternalDomain: 'host.example.com',
} as IServerConfig; // Cast to avoid filling out all properties

// Helper factory function to create tenant configurations for tests, reducing repetition.
const createTestTenantConfig = (
  sector: Sector,
  didId: string,
  sectorsAllowed: Sector[] = []
): EntityConfig => {
  const result: EntityConfig = {
    id: 'urn:uuid:tenant-uuid',
    type: 'org.schema.Organization', // Missing 'type' property added
    status: 'active',
    meta: { lastUpdated: '' },
    claims: {
      alternateName: 'acme',
      legalName: 'ACME Inc.',
      addressCountry: 'ES',
      url: 'https://acme.com',
    },
    didConfig: { // Missing 'didConfig' property added
      service: []
    },
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
  } as unknown as EntityConfig;
  return result;
};

describe('Service Initialization Utilities', () => {

  describe('initializeTenantServicesConfig', () => {
    
    it('should create default entity and individual services for a non-FHIR tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.TEST, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider.service.sectorCategory as Sector);

      // ASSERT
      expect(services).toHaveLength(4); // 2 business + 2 network

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).not.toContain('Practitioner');

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).not.toContain('Patient');
    });

    it('should ADD FHIR resources for a FHIR-enabled tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.HEALTH_CARE, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider.service.sectorCategory as Sector);
      
      // ASSERT
      expect(services).toHaveLength(4);

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).toContain('Practitioner');

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).toContain('Patient');
    });

    it('should not include standard discovery endpoints', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.TEST, 'did:web:acme.com');

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider.service.sectorCategory as Sector);

      // ASSERT
      const didDocService = services.find((s: DidService) => s.id.endsWith('#did-document'));
      expect(didDocService).toBeUndefined();

      const jwksService = services.find((s: DidService) => s.id.endsWith('#jwks'));
      expect(jwksService).toBeUndefined();
    });
  });

  describe('initializeHostServicesConfig', () => {
    it('should create registry services for each allowed sector', () => {
      // ARRANGE
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, `did:web:${mockConfig.hostExternalDomain}`, [Sector.TEST, Sector.HEALTH_CARE]);
      if (hostConfig.claims) {
        (hostConfig.claims as any).alternateName = 'host'; // Override for host specific test
      }

      // ACT
      const services = initializeHostServicesConfig(hostConfig.provider.service.sectorsAllowed as Sector[]);

      // ASSERT
      const registryServices = services.filter((s: DidService) => s.id.includes(':registry:'));
      expect(registryServices).toHaveLength(2); // test + health-care
      
      // The service ID format is v1:SECTOR:registry:org-schema. We search for the sector part.
      const testRegistry = registryServices.find((s: DidService) => s.id.match(new RegExp(`:${Sector.TEST}:`, 'i')));
      expect(testRegistry).toBeDefined();
      expect(testRegistry!.serviceEndpoint).toBe('Organization');
      
      const healthRegistry = registryServices.find((s: DidService) => s.id.match(new RegExp(`:${Sector.HEALTH_CARE}:`, 'i')));
      expect(healthRegistry).toBeDefined();
    });
  });
});