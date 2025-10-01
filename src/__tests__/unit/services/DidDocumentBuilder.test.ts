// src/__tests__/unit/services/DidDocumentBuilder.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidDocumentBuilder, BuildDidDocumentParams } from '../../../services/DidDocumentBuilder';
import { JwkSet } from '../../../models/jwk';
import { DidService } from '../../../models/did';

describe('DidDocumentBuilder', () => {
  it('should correctly build and multiplex a DID Document', () => {
    // 1. Arrange
    const configServices: DidService[] = [
      {
        id: 'v1_test_entity_org.schema',
        type: 'ApiService',
        serviceEndpoint: 'Organization,Practitioner', // 2 resources
        actions: ['_batch', '_read'], // 2 actions
      },
      {
        id: 'v1_test_registry_org.schema',
        type: 'ApiService',
        serviceEndpoint: 'Organization', // 1 resource
        actions: ['_batch'], // 1 action
      },
    ];

    const publicKeys: JwkSet = {
      keys: [
        {
          kid: 'sig-key-1',
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'p2-_--R-__--Rp',
          use: 'sig',
        },
      ],
    };

    const params: BuildDidDocumentParams = {
      didId: 'did:web:example.com:acme',
      baseUrl: 'https://example.com/acme/cds-us',
      publicKeysJwk: publicKeys,
      configServices: configServices,
    };

    const builder = new DidDocumentBuilder();

    // 2. Act
    const didDocument = builder.build(params);

    // 3. Assert
    expect(didDocument).toBeDefined();
    expect(didDocument.id).toBe('did:web:example.com:acme');
    expect(didDocument['@context']).toBe('https://www.w3.org/ns/did/v1');

    // Assert Verification Method
    expect(didDocument.verificationMethod).toHaveLength(1);
    const vm = didDocument.verificationMethod![0];
    // expect(vm.id).toBe('did:web:example.com:acme#sig-key-1');
    expect(vm.controller).toBe('did:web:example.com:acme');
    expect(vm.publicKeyJwk.kid).toBe('sig-key-1');

    // Assert Multiplexed Services
    // Expect 2*2 + 1*1 = 5 services in total
    expect(didDocument.service).toHaveLength(5);

    // Spot-check one of the expanded services from the first template
    const orgBatchService = didDocument.service!.find(s => s.id.includes('organization-batch'));
    expect(orgBatchService).toBeDefined();
    expect(orgBatchService!.id).toBe('did:web:example.com:acme#v1-test-entity-org.schema-organization-batch');
    expect(orgBatchService!.serviceEndpoint).toBe('https://example.com/acme/cds-us/test/entity/org.schema/Organization/_batch');

    // Spot-check another expanded service from the first template
    const practitionerReadService = didDocument.service!.find(s => s.id.includes('practitioner-read'));
    expect(practitionerReadService).toBeDefined();
    expect(practitionerReadService!.id).toBe('did:web:example.com:acme#v1-test-entity-org.schema-practitioner-read');
    expect(practitionerReadService!.serviceEndpoint).toBe('https://example.com/acme/cds-us/test/entity/org.schema/Practitioner/_read');

    // Spot-check the service from the second template
    const registryService = didDocument.service!.find(s => s.id.includes('registry'));
    expect(registryService).toBeDefined();
    expect(registryService!.id).toBe('did:web:example.com:acme#v1-test-registry-org.schema-organization-batch');
    expect(registryService!.serviceEndpoint).toBe('https://example.com/acme/cds-us/test/registry/org.schema/Organization/_batch');
  });
});
