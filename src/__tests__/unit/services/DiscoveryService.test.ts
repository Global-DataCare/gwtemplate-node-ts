// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DiscoveryService } from '../../../services/DiscoveryService';

describe('DiscoveryService', () => {
  it('should publish public issuer urls and operational token endpoints independently', async () => {
    const tenantsCacheManager = {
      getDidDocument: jest.fn(async () => ({
        id: 'did:web:public.acme.org',
        '@context': 'https://www.w3.org/ns/did/v1',
        service: [
          { id: 'did:web:public.acme.org#did-document', type: 'LinkedDomains', serviceEndpoint: 'https://public.acme.org/.well-known/did.json' },
          { id: 'did:web:public.acme.org#jwks', type: 'JsonWebKeyService2020', serviceEndpoint: 'https://public.acme.org/jwks.json' },
        ],
      })),
      getTenantDomainUrl: jest.fn(async () => 'https://public.acme.org'),
      getTenantOperationalUrl: jest.fn(async () => 'https://operator.gateway.net/acme/cds-es/v1/health-care'),
    } as any;

    const service = new DiscoveryService(tenantsCacheManager);
    const config = await service.getOpenIdConfiguration('health-care_acme');

    expect(config).toEqual(expect.objectContaining({
      issuer: 'https://public.acme.org',
      jwks_uri: 'https://public.acme.org/jwks.json',
      did_document: 'https://public.acme.org/.well-known/did.json',
      authorization_endpoint: 'https://operator.gateway.net/acme/cds-es/v1/health-care/identity/oidc/authorize',
      token_endpoint: 'https://operator.gateway.net/acme/cds-es/v1/health-care/identity/oidc/token',
    }));
  });
});
