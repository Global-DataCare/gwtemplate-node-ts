// src/__tests__/unit/utils/request-validator.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { isRequestValid } from '../../../utils/request-validator';
import { DidService } from 'gdc-common-utils-ts/models/did';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

describe('isRequestValid', () => {
  const mockServices: DidService[] = [
    {
      id: '#entity:org.schema',
      type: 'ApiService',
      serviceEndpoint: 'Organization,Employee,Place',
      actions: ['_create', '_batch'],
      selector: { section: 'entity', format: 'org.schema' },
    },
    {
      id: '#entity:org.schema:employee',
      type: 'ApiService',
      serviceEndpoint: 'Employee',
      actions: ['_purge'],
      selector: { section: 'entity', format: 'org.schema' },
    },
    {
      id: '#test-network:org.schema',
      type: 'NetworkEnrollmentService',
      serviceEndpoint: 'Action',
      actions: ['_batch'],
      selector: { section: 'test-network', format: 'org.schema' },
    },
    {
      id: '#registry:org.schema',
      type: 'ApiService',
      serviceEndpoint: 'Organization',
      actions: ['_batch', '_activate', '_disable', '_enable'],
      selector: { section: 'registry', format: 'org.schema' },
    },
    {
      id: '#registry:org.schema:order',
      type: 'ApiService',
      serviceEndpoint: 'Order',
      actions: ['_batch'],
      selector: { section: 'registry', format: 'org.schema' },
    },
    {
      id: '#individual:org.schema',
      type: 'ApiService',
      serviceEndpoint: 'Organization',
      actions: ['_transaction', '_disable', '_purge'],
      selector: { section: 'individual', format: 'org.schema' },
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

  it('should return TRUE for the new host organization activation action', () => {
    const params = {
      sector: 'test',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_activate',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return TRUE for the new host organization disable action', () => {
    const params = {
      sector: 'test',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_disable',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return FALSE for lifecycle actions on Order', () => {
    const params = {
      sector: 'test',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Order',
      action: '_enable',
    };
    expect(isRequestValid(mockServices, params)).toBe(false);
  });

  it('should return TRUE for individual organization _transaction alias', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_transaction',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return TRUE for individual organization _purge', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_purge',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return TRUE for individual organization _disable', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      resourceType: 'Organization',
      action: '_disable',
    };
    expect(isRequestValid(mockServices, params)).toBe(true);
  });

  it('should return TRUE for employee _purge', () => {
    const params = {
      sector: Sector.HEALTH_CARE,
      section: 'entity',
      format: 'org.schema',
      resourceType: 'Employee',
      action: '_purge',
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
