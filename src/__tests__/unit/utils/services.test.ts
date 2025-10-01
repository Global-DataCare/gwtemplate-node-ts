// src/__tests__/unit/utils/services.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { initializeHostServices, initializeTenantServices } from '../../../utils/services';
import { TenantConfig } from '../../../models/tenant';
import { Sector } from '../../../models/sector';
import { config } from '../../../config';

// Helper factory function to create tenant configurations for tests, reducing repetition.
const createTestTenantConfig = (
  sector: Sector,
  didId: string,
  sectorsAllowed: Sector[] = []
): TenantConfig => {
  return {
    id: 'urn:uuid:tenant-uuid',
    identifier: 'tenant-id',
    alternateName: 'acme',
    legalName: 'ACME Inc.',
    jurisdiction: 'ES',
    url: 'https://acme.com',
    meta: { lastUpdated: '' },
    sector,
    sectorsAllowed,
    didConfig: {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: didId,
      service: [],
    },
  };
};

describe('Service Initialization Utilities', () => {

  describe('initializeTenantServices', () => {
    
    it('should create default entity and profile services for a non-FHIR tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.TEST, `did:web:${config.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServices(tenantConfig);

      // ASSERT
      expect(services).toHaveLength(4); // 2 discovery + 2 business

      const entityService = services.find(s => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).not.toContain('Practitioner');

      const profileService = services.find(s => s.id.includes('profile'));
      expect(profileService).toBeDefined();
      expect(profileService!.serviceEndpoint).toContain('Customer');
      expect(profileService!.serviceEndpoint).not.toContain('Patient');
    });

    it('should ADD FHIR resources for a FHIR-enabled tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.HEALTH_CARE, `did:web:${config.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServices(tenantConfig);
      
      // ASSERT
      expect(services).toHaveLength(4);

      const entityService = services.find(s => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      // It should contain BOTH the base resource and the FHIR resource
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).toContain('Practitioner');

      const profileService = services.find(s => s.id.includes('profile'));
      expect(profileService).toBeDefined();
      // It should contain BOTH the base resource and the FHIR resource
      expect(profileService!.serviceEndpoint).toContain('Customer');
      expect(profileService!.serviceEndpoint).toContain('Patient');
    });

    it('should include standard discovery endpoints', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.TEST, 'did:web:acme.com');

      // ACT
      const services = initializeTenantServices(tenantConfig);

      // ASSERT
      const didDocService = services.find(s => s.id.endsWith('#did-document'));
      expect(didDocService).toBeDefined();
      expect(didDocService!.serviceEndpoint).toBe('https://acme.com/.well-known/did.json');

      const jwksService = services.find(s => s.id.endsWith('#jwks'));
      expect(jwksService).toBeDefined();
      expect(jwksService!.serviceEndpoint).toBe('https://acme.com/jwks.json');
    });
  });

  describe('initializeHostServices', () => {
    it('should create registry services for each allowed sector', () => {
      // ARRANGE
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, `did:web:${config.hostExternalDomain}`, [Sector.TEST, Sector.HEALTH_CARE]);
      hostConfig.alternateName = 'host'; // Override for host specific test

      // ACT
      const services = initializeHostServices(hostConfig);

      // ASSERT
      const registryServices = services.filter(s => s.id.includes('_registry_'));
      expect(registryServices).toHaveLength(2); // test + health-care
      
      // The service ID format is v1_SECTOR_registry_org-schema. We search for the sector part.
      const testRegistry = registryServices.find(s => s.id.match(new RegExp(`_${Sector.TEST}_`, 'i')));
      expect(testRegistry).toBeDefined();
      expect(testRegistry!.serviceEndpoint).toBe('Organization');
      
      const healthRegistry = registryServices.find(s => s.id.match(new RegExp(`_${Sector.HEALTH_CARE}_`, 'i')));
      expect(healthRegistry).toBeDefined();
    });
  });
});