import { createApiDocsSetupOptions } from '../../../managers/ApiDocsManager';

describe('ApiDocsManager Global Flow Context', () => {
  it('includes canonical tenant, individual, and physician helper fields', () => {
    const options = createApiDocsSetupOptions();
    const script = String(options.customJsStr || '');

    expect(script).toContain("key: 'taxTenantId'");
    expect(script).toContain("placeholder: 'acme-id'");
    expect(script).toContain('getCanonicalTenantId');
    expect(script).toContain("key: 'portalNamespace'");
    expect(script).toContain("placeholder: 'globaldatacare.es'");
    expect(script).toContain("key: 'individualUuid'");
    expect(script).toContain("key: 'individualDid'");
    expect(script).toContain("key: 'individualControllerEmail'");
    expect(script).toContain("key: 'individualControllerRole'");
    expect(script).toContain("key: 'individualControllerDid'");
    expect(script).toContain("key: 'physicianEmail'");
    expect(script).toContain("key: 'physicianRole'");
    expect(script).toContain("key: 'sectionsAllowed'");
    expect(script).toContain("key: 'physicianOrg'");
    expect(script).toContain("key: 'physicianDid'");
    expect(script).not.toContain("label: 'tenantId'");
    expect(script).not.toContain("label: 'tax id'");
    expect(script).toContain('buildPhysicianOrgDid');
    expect(script).toContain('buildMemberDid');
    expect(script).toContain('buildIndividualControllerDid');
    expect(script).toContain('sha256Multibase58btc');
    expect(script).toContain('buildIndividualDid');
    expect(script).toContain('getCurrentIndividualId');
    expect(script).toContain('migrateLegacyContextValues');
    expect(script).toContain('normalizeLegacyCanonicalTenantId');
    expect(script).toContain('PANEL_VERSION');
    expect(script).toContain('uuidToMultibase58btc');
    expect(script).toContain('globaldatacare.es');
    expect(script).toContain('acme-id');
    expect(script).toContain('doctor1@acme.org');
    expect(script).toContain('ISCO-08|2211');
    expect(script).toContain('LOINC|48765-2');
    expect(script).toContain('{{individualDid}}');
    expect(script).toContain('{{individualControllerDid}}');
    expect(script).toContain('{{physicianOrg}}');
    expect(script).toContain('{{physicianDid}}');
  });
});
