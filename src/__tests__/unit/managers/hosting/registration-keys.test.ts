// TDD contract: write this test red first; make it green only with the complete real behavior.
import { normalizeBindingAliasList } from '../../../../managers/hosting/registration-keys';

describe('normalizeBindingAliasList', () => {
  it('preserves DID and URN aliases while normalizing public domains as HTTPS URLs', () => {
    const organizationDid =
      'did:web:globaldatacare.es:health-care:organization:taxid:VATES-B42215152';
    const organizationUrn = 'urn:gdc:organization:VATES-B42215152';

    expect(normalizeBindingAliasList([
      organizationDid,
      organizationUrn,
      'host-accuro.globaldatacare.es',
      'http://globaldatacare.es',
    ])).toEqual([
      organizationDid,
      organizationUrn,
      'https://host-accuro.globaldatacare.es',
      'https://globaldatacare.es',
    ]);
  });
});
