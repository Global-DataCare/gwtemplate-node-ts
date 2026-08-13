import {
  buildGovernedCapabilityStatement,
  buildGovernedFhirArtifactUrl,
} from '../../../services/fhir-governance-artifacts';

describe('UNID-governed FHIR canonical artifacts', () => {
  it('builds stable canonical urls below the configured unid.online authority', () => {
    expect(buildGovernedFhirArtifactUrl(
      'https://unid.online/standards/fhir',
      'SearchParameter',
      'contract-type',
    )).toBe('https://unid.online/standards/fhir/SearchParameter/contract-type');
  });

  it('rejects non-HTTPS canonical authorities', () => {
    expect(() => buildGovernedFhirArtifactUrl(
      'http://unid.online/standards/fhir',
      'CodeSystem',
      'contract-type',
    )).toThrow(/HTTPS/);
  });

  it('builds a tenant instance that instantiates the UNID profile', () => {
    const statement = buildGovernedCapabilityStatement({
      canonicalBaseUrl: 'https://unid.online/standards/fhir',
      implementationVersion: '1.0.0',
      implementationUrl: 'https://gw.example/tenant/cds-es/v1/antifraud/fhir',
      implementationDescription: 'Personal FHIR index for tenant vault-a',
      enableContractSearchParameters: false,
    }) as any;

    expect(statement).not.toHaveProperty('url');
    expect(statement.kind).toBe('instance');
    expect(statement.instantiates).toEqual([
      'https://unid.online/standards/fhir/CapabilityStatement/gw-core|1.0.0',
    ]);
    expect(statement.implementation).toEqual({
      description: 'Personal FHIR index for tenant vault-a',
      url: 'https://gw.example/tenant/cds-es/v1/antifraud/fhir',
    });
    expect(statement.implementationGuide).toContain(
      'https://unid.online/standards/fhir/ImplementationGuide/network-governance',
    );
    const resources = statement.rest[0].resource;
    const communication = resources.find((resource: any) => resource.type === 'Communication');
    expect(communication.searchParam).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'actor',
        definition: 'https://unid.online/standards/fhir/SearchParameter/communication-actor',
      }),
    ]));
    expect(resources.some((resource: any) => resource.type === 'Contract')).toBe(false);
  });

  it('can advertise governed Contract search parameters after runtime support is enabled', () => {
    const statement = buildGovernedCapabilityStatement({
      canonicalBaseUrl: 'https://unid.online/standards/fhir',
      implementationVersion: '1.0.0',
      implementationUrl: 'https://gw.example/tenant/cds-es/v1/antifraud/fhir',
      implementationDescription: 'Tenant FHIR index',
      enableContractSearchParameters: true,
    }) as any;

    const contract = statement.rest[0].resource.find((resource: any) => resource.type === 'Contract');
    expect(contract.searchParam).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'type',
        type: 'token',
        definition: 'https://unid.online/standards/fhir/SearchParameter/contract-type',
      }),
    ]));
  });

  it('rejects an instance without an HTTPS implementation endpoint', () => {
    expect(() => buildGovernedCapabilityStatement({
      canonicalBaseUrl: 'https://unid.online/standards/fhir',
      implementationVersion: '1.0.0',
      implementationUrl: 'http://tenant.example/fhir',
      implementationDescription: 'Tenant FHIR index',
      enableContractSearchParameters: false,
    })).toThrow(/implementation URL.*HTTPS/i);
  });
});
