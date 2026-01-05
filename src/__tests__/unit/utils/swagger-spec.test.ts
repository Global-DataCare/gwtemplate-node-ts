import { generateSwaggerSpec } from '../../../utils/swagger-spec';

describe('Swagger Spec Generation', () => {
  it('includes onboarding endpoints in the same journey order as API_INTEGRATORS_GUIDE', async () => {
    const spec = await generateSwaggerSpec();

    expect(spec.paths).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response']).toBeDefined();
    expect(spec.paths['/host/.well-known/ping']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/ping']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/did.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/jwks.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/openid-configuration']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/smart-configuration']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/fhir/metadata']).toBeDefined();

    // Swagger tags are intentionally numbered progressively (1..N) for readability in Swagger UI,
    // even though API_INTEGRATORS_GUIDE uses its own section numbering (6..9).
    expect(Array.isArray(spec.tags)).toBe(true);
    const tagNames = (spec.tags || []).map((t: any) => t.name);
    expect(tagNames).toEqual(
      expect.arrayContaining([
        '1.1 Organization Registration',
        '1.2 Organization Order',
        '2.1.1 Identity Federation',
        '2.1.2 Initial Access Token Exchange',
        '2.1.3 Device Registration (DCR)',
        '2.2 SMART Token',
        '3.1 Employee Role',
        '4.1 Family Registration',
        '4.2 Family Order',
        '5. Consent',
        '6. Communication',
        '7. Composition',
        '4.3 Family Member Relationship',
        '8.4 Personal Observations',
      ]),
    );
    expect(spec['x-tagGroups']).toBeDefined();

    // Host onboarding uses a dedicated "network environment" sector enum.
    expect(spec.components?.parameters?.HostRegistrySector).toBeDefined();
    expect(spec.components?.parameters?.AppId).toBeDefined();
    expect(spec.components?.parameters?.AppVersion).toBeDefined();

    // Required examples for the onboarding journey. We treat example-payloads.ts as source of truth,
    // and Swagger generation must include them to stay aligned with API_INTEGRATORS_GUIDE.
    const exampleKeys = Object.keys(spec.components?.examples || {});
    expect(exampleKeys).toEqual(
      expect.arrayContaining([
        'OrganizationRegistrationPlaintextMessage',
        'OrganizationOrderPlaintextMessage',
        'InitialAccessTokenExchangePlaintextMessage',
        'FirebaseCustomTokenPlaintextMessage',
        'DeviceRegistrationPlaintextMessage',
        'SmartTokenRequestPlaintextMessage',
        'EmployeeRegistrationPlaintextMessage',
        'FamilyRegistrationPlaintextMessage',
        'FamilyOrderPlaintextMessage',
        'ConsentCreationPlaintextMessage',
        'CommunicationCreationPlaintextMessage',
        'CompositionUpdatePlaintextMessage',
        'FamilyMemberRelationshipPlaintextMessage',
        'PersonalObservationPlaintextMessage',
        'AsyncPollRequest',
        'AsyncPollPending',
        'AsyncPollSecureResponse',
      ]),
    );
    for (const key of [
      'OrganizationRegistrationPlaintextMessage',
      'OrganizationOrderPlaintextMessage',
      'InitialAccessTokenExchangePlaintextMessage',
      'FirebaseCustomTokenPlaintextMessage',
      'DeviceRegistrationPlaintextMessage',
      'SmartTokenRequestPlaintextMessage',
      'EmployeeRegistrationPlaintextMessage',
      'FamilyRegistrationPlaintextMessage',
      'FamilyOrderPlaintextMessage',
      'ConsentCreationPlaintextMessage',
      'CommunicationCreationPlaintextMessage',
      'CompositionUpdatePlaintextMessage',
      'FamilyMemberRelationshipPlaintextMessage',
      'PersonalObservationPlaintextMessage',
      'AsyncPollRequest',
      'AsyncPollPending',
      'AsyncPollSecureResponse',
    ]) {
      expect(spec.components.examples[key]?.value).toBeDefined();
      expect(Object.keys(spec.components.examples[key].value || {}).length).toBeGreaterThan(0);
    }
  });
});
