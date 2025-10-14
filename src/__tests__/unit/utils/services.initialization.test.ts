// src/__tests__/unit/utils/services.initialization.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { initializeTenantServices } from '../../../utils/services';
import { Sector } from '../../../models/path';
import { DidService } from '../../../models/did';

describe('initializeTenantServices', () => {
  it('should include the "test-network" enrollment service by default for all new tenants', () => {
    // --- Arrange ---
    const tenantDid = 'did:web:acme.com';
    const tenantSector = Sector.HEALTH_CARE;

    // --- Act ---
    const services: DidService[] = initializeTenantServices(tenantDid, tenantSector);

    // --- Assert ---
    const enrollmentService = services.find(s => s.id.includes('_test-network_'));
    
    expect(enrollmentService).toBeDefined();
    expect(enrollmentService?.type).toBe('NetworkEnrollmentService');
    expect(enrollmentService?.serviceEndpoint).toBe('Action');
    expect(enrollmentService?.actions).toEqual(['_batch']);
  });
});
