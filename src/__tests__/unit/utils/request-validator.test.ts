// src/__tests__/unit/utils/request-validator.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { isRequestValid } from '../../../utils/request-validator';
import { DidService } from '../../../models/did';
import { Sector } from '../../../models/urlPath';

describe('isRequestValid', () => {
  const mockServices: DidService[] = [
    {
      id: 'v1:health-care:entity:org.schema',
      type: 'ApiService',
      serviceEndpoint: 'Organization,Employee,Place',
      actions: ['_create', '_batch'],
    },
    {
      id: 'v1:health-care:test-network:org.schema:action',
      type: 'NetworkEnrollmentService',
      serviceEndpoint: 'Action',
      actions: ['_batch'],
    },
    {
      id: 'v1:test:registry:org.schema',
      type: 'ApiService',
      serviceEndpoint: 'Organization',
      actions: ['_batch'],
    }
  ];

  it('should return TRUE for a valid request matching a GENERAL service definition', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'Employee',
      action: '_create',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return TRUE for a valid request matching a SPECIFIC service definition', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'test-network',
      format: 'org.schema',
      resourceType: 'Action',
      action: '_batch',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });
  
  it('should return TRUE for a request where resourceType has different casing', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'organization', // Lowercase
      action: '_batch',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return FALSE if no services are defined for the tenant', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'Employee',
      action: '_create',
    };
    expect(isRequestValid(undefined, params)).toBe(false);
  });

  it('should return FALSE if no matching service is found', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'non-existent-section',
      format: 'org.schema',
      resourceType: 'Employee',
      action: '_create',
    };
    expect(isRequestValid(mockServices, params)).toBe(false);
  });

  it('should return FALSE if the resourceType is not listed in the matching service', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'Patient', // Not in 'Organization,Employee,Place'
      action: '_create',
    };
    expect(isRequestValid(mockServices, params)).toBe(false);
  });

  it('should return FALSE if the action is not listed in the matching service', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'Employee',
      action: '_delete', // Not in ['_create', '_batch']
    };
    expect(isRequestValid(mockServices, params)).toBe(false);
  });
});
