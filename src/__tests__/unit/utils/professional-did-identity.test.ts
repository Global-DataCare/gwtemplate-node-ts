// Flow contract: parse both internal hosted and public organization did:web forms into the same tenant, employee hash and role without treating the hostname as organizational authority.
import { buildHostedProviderDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import { parseProfessionalDidIdentity } from '../../../utils/professional-did-identity';

describe('professional DID identity extraction', () => {
  const tenantId = 'VATES-B00112233';
  const role = 'ISCO-08|2211';
  const email = 'doctor@example.org';

  it.each([
    'did:web:api.internal.example:VATES-B00112233:cds-ES:v1:health-care',
    buildHostedProviderDidWeb({
      hostDomain: 'globaldatacare.es',
      sector: 'health-care',
      providerTaxId: tenantId,
    }),
  ])('extracts the tenant and stable employee identity from %s', (organizationDidWeb) => {
    const employeeDid = buildProfessionalDidWeb({ organizationDidWeb, email, role });

    expect(parseProfessionalDidIdentity(employeeDid)).toMatchObject({
      organizationIdentifier: tenantId,
      organizationDid: organizationDidWeb,
      membershipMarker: 'employee',
      role,
    });
    expect(parseProfessionalDidIdentity(employeeDid)?.stableActorIdentifier).toMatch(/^urn:multibase:z/);
  });

  it('accepts member as a compatibility marker but rejects a root DID without a tenant identifier', () => {
    const employeeDid = buildProfessionalDidWeb({
      organizationDidWeb: buildHostedProviderDidWeb({
        hostDomain: 'globaldatacare.es',
        sector: 'health-care',
        providerTaxId: tenantId,
      }),
      email,
      role,
    }).replace(':employee:', ':member:');

    expect(parseProfessionalDidIdentity(employeeDid)?.organizationIdentifier).toBe(tenantId);
    expect(parseProfessionalDidIdentity('did:web:globaldatacare.es:employee:z123:ISCO-08|2211')).toBeUndefined();
  });
});
