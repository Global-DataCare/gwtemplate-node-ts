// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DiscoveryService } from '../../../services/DiscoveryService';
import { NativeFhirFormats } from '../../../constants/fhir-discovery';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../../../constants/domain';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { Format } from 'gdc-common-utils-ts/models/urlPath';

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

  it('publishes tenant-specific FHIR metadata for the exact section and format capability', async () => {
    const tenantsCacheManager = {
      getTenantOperationalUrl: jest.fn(async () => 'https://operator.gateway.net/acme/cds-es/v1/antifraud'),
      getDidServiceConfig: jest.fn(async () => [{
        selector: { section: SUBJECT_SECTION_INDIVIDUAL, format: NativeFhirFormats.R4 },
        serviceEndpoint: `${ResourceTypesFhirR4.Communication},${ResourceTypesFhirR4.Observation}`,
        actions: ['_batch'],
      }, {
        selector: { section: SUBJECT_SECTION_DIGITAL_TWIN, format: NativeFhirFormats.R4 },
        serviceEndpoint: ResourceTypesFhirR4.ResearchSubject,
        actions: ['_search'],
      }]),
    } as any;
    const service = new DiscoveryService(tenantsCacheManager);

    const statement = await service.getCapabilityStatement('antifraud_acme', {
      section: SUBJECT_SECTION_DIGITAL_TWIN,
      format: NativeFhirFormats.R4,
    }) as any;

    expect(tenantsCacheManager.getTenantOperationalUrl).toHaveBeenCalledWith('antifraud_acme');
    expect(tenantsCacheManager.getDidServiceConfig).toHaveBeenCalledWith('antifraud_acme');
    expect(statement.kind).toBe('instance');
    expect(statement.fhirVersion).toBe('4.0.1');
    expect(statement.implementation.url).toBe(
      `https://operator.gateway.net/acme/cds-es/v1/antifraud/${SUBJECT_SECTION_DIGITAL_TWIN}/${NativeFhirFormats.R4}`,
    );
    expect(statement.rest[0].resource.map((resource: any) => resource.type)).toEqual([
      ResourceTypesFhirR4.ResearchSubject,
    ]);
    expect(statement.instantiates[0]).toBe(
      'https://unid.online/standards/fhir/CapabilityStatement/gw-core|1.0.0',
    );
  });

  it('does not misrepresent the flat-claims API as a native FHIR server base', async () => {
    const tenantsCacheManager = {
      getTenantOperationalUrl: jest.fn(async () => 'https://operator.gateway.net/acme/cds-es/v1/health-care'),
      getDidServiceConfig: jest.fn(async () => [{
        selector: { section: SUBJECT_SECTION_INDIVIDUAL, format: Format.FhirApi },
        serviceEndpoint: ResourceTypesFhirR4.Communication,
        actions: ['_batch'],
      }]),
    } as any;

    const statement = await new DiscoveryService(tenantsCacheManager).getCapabilityStatement(
      'health-care_acme',
      { section: SUBJECT_SECTION_INDIVIDUAL, format: Format.FhirApi },
    );

    expect(statement).toBeUndefined();
  });
});
