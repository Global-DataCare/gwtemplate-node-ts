// src/__tests__/unit/utils/did-document.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createDefaultDidDocument } from '../../../utils/did-document';

describe('createDefaultDidDocument', () => {

  const mockApiHostname = 'example.com';

  it('should create a correct DID Document for the "host"', () => {
    // --- Arrange ---
    const params = {
      alternateName: 'host',
      apiHostname: mockApiHostname,
      sector: 'system',
    };

    // --- Act ---
    const didDoc = createDefaultDidDocument(params);

    // --- Assert ---
    expect(didDoc.id).toBe('did:web:example.com');
    expect(didDoc.service).toHaveLength(3);
    
    // Check discovery service endpoint
    const discoveryService = didDoc.service?.find(s => s.id === '#did-document');
    expect(discoveryService).toBeDefined();
    expect(discoveryService?.serviceEndpoint).toBe('https://example.com/.well-known/did.json');
    
    // Check registry service ID
    const registryService = didDoc.service?.find(s => s.type === 'GatewayRegistryService');
    expect(registryService).toBeDefined();
    expect(registryService?.id).toBe('v1_system_registry_org-schema');
  });

  it('should create a correct DID Document for a tenant', () => {
    // --- Arrange ---
    const params = {
      alternateName: 'acme-corp',
      apiHostname: mockApiHostname,
      sector: 'health-care',
    };

    // --- Act ---
    const didDoc = createDefaultDidDocument(params);

    // --- Assert ---
    expect(didDoc.id).toBe('did:web:example.com:acme-corp');
    expect(didDoc.service).toHaveLength(3);

    // Check discovery service endpoint
    const discoveryService = didDoc.service?.find(s => s.id === '#did-document');
    expect(discoveryService).toBeDefined();
    expect(discoveryService?.serviceEndpoint).toBe('https://example.com/acme-corp/.well-known/did.json');

    // Check registry service ID
    const registryService = didDoc.service?.find(s => s.type === 'GatewayRegistryService');
    expect(registryService).toBeDefined();
    expect(registryService?.id).toBe('v1_health-care_registry_org-schema');
  });

});
