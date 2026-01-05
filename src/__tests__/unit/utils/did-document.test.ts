// src/__tests__/unit/utils/did-document.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { populateDidDocumentServices } from '../../../utils/did-document';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
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
    // Total multiplexed services = 24 (18 business + 2 network + 4 identity) + 2 (well-known) = 26
    expect(allServices).toHaveLength(26);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://gateway.com/acme/cds-es/v1/health-care/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#entity:org.schema:employee:_batch'));
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
    // Total multiplexed services = 24 (18 business + 2 network + 4 identity) + 2 (well-known) = 26
    expect(allServices).toHaveLength(26);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://api.acme-health.com/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#entity:org.schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toBe('https://api.acme-health.com/entity/org.schema/Employee/_batch');
  });
});
