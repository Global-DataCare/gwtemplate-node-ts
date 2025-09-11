// src/__tests__/unit/utils/did.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { getHostDid, getTenantDid } from '../../../utils/did';
import { config } from '../../../config';

// Mock the entire config module to control its values during tests.
jest.mock('../../../config');

describe('DID Utilities', () => {

  // Cast config to 'any' to allow dynamic modification of its properties for testing.
  const mutableConfig = config as any;

  it('should create the correct host DID for a URL with a port', () => {
    // Arrange
    mutableConfig.apiBaseUrl = 'http://localhost:3000';
    
    // Act
    const did = getHostDid();

    // Assert
    expect(did).toBe('did:web:localhost%3A3000');
  });

  it('should create the correct host DID for a URL without a port', () => {
    // Arrange
    mutableConfig.apiBaseUrl = 'https://antifraud.example.com';
    
    // Act
    const did = getHostDid();

    // Assert
    expect(did).toBe('did:web:antifraud.example.com');
  });

  it('should create the correct tenant DID, including the host DID', () => {
    // Arrange
    mutableConfig.apiBaseUrl = 'https://api.service.io';
    const tenantId = 'tenant-abc-123';

    // Act
    const did = getTenantDid(tenantId);

    // Assert
    expect(did).toBe('did:web:api.service.io:tenant-abc-123');
  });

  it('should handle percent-encoding for the port in tenant DIDs', () => {
    // Arrange
    mutableConfig.apiBaseUrl = 'http://127.0.0.1:8080';
    const tenantId = 'another-tenant';

    // Act
    const did = getTenantDid(tenantId);

    // Assert
    expect(did).toBe('did:web:127.0.0.1%3A8080:another-tenant');
  });

});
