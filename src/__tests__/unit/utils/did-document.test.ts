// src/__tests__/unit/utils/did-document.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { populateDidDocumentServices } from '../../../utils/did-document';
import { Sector } from '../../../models/urlPath';
import { initializeTenantServicesConfig } from '../../../utils/services';

describe('populateDidDocumentServices', () => {

  it('should correctly multiplex services for a HOSTED tenant', () => {
    // --- Arrange ---
    const did = 'did:web:gateway.com:acme:cds-es:v1:health-care';
    const baseUrl = 'https://gateway.com';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE };

    // --- Act ---
    const allServices = populateDidDocumentServices(did, baseUrl, businessConfig, true, tenantContext);

    // --- Assert ---
    // Multiplexing check: 
    // Total Business Services = 34 (14 entity + 14 individual + 2 PersonDiscovery + 2 NetworkEnrollment)
    // Total services = 34 (business) + 2 (well-known) = 36
    expect(allServices).toHaveLength(36);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://gateway.com/acme/cds-es/v1/health-care/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#v1:health-care:entity:org-schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toBe('https://gateway.com/acme/cds-es/v1/health-care/entity/org.schema/Employee/_batch');
  });

  it('should correctly multiplex services for an OWN-DOMAIN tenant', () => {
    // --- Arrange ---
    const did = 'did:web:api.acme-health.com';
    const baseUrl = 'https://api.acme-health.com';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = {} as any;

    // --- Act ---
    const allServices = populateDidDocumentServices(did, baseUrl, businessConfig, false, tenantContext);

    // --- Assert ---
    // Multiplexing check: (Same as above) = 30 services
    // Total services = 34 (business) + 2 (well-known) = 36
    expect(allServices).toHaveLength(36);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://api.acme-health.com/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#v1:health-care:entity:org-schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toBe('https://api.acme-health.com/entity/org.schema/Employee/_batch');
  });
});
