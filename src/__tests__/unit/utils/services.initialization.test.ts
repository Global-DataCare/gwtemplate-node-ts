// src/__tests__/unit/utils/services.initialization.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { initializeTenantServicesConfig } from '../../../utils/services';
import { Sector } from '../../../models/urlPath';
import { DidService } from '../../../models/did';

describe('initializeTenantServicesConfig', () => {
  it('should include the "test-network" enrollment service by default for all new tenants', () => {
    // --- Arrange ---
    const tenantSector = Sector.HEALTH_CARE;

    // --- Act ---
    const services: DidService[] = initializeTenantServicesConfig(tenantSector);

    // --- Assert ---
    const enrollmentService = services.find(s => s.type === 'NetworkEnrollmentService');
    
    expect(enrollmentService).toBeDefined();
    expect(enrollmentService?.type).toBe('NetworkEnrollmentService');
    expect(enrollmentService?.serviceEndpoint).toBe('Action');
    expect(enrollmentService?.actions).toEqual(['_batch']);
  });
});
