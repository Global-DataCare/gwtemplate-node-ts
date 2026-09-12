// TDD contract: write this test red first; make it green only with the complete real behavior.
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

import {
  buildLedgerOrganizationId,
  resolveLedgerOrganizationId,
  resolveRoleLicenseOrganizationOfficialId,
} from '../../../utils/ledger-organization-registration-helpers';

describe('ledger organization registration helpers', () => {
  it('extracts the bare official identifier from canonical CDS and legacy organization URNs', () => {
    expect(resolveRoleLicenseOrganizationOfficialId('urn:cds-es:v1:organization:tax:acme-id')).toBe('acme-id');
    expect(resolveRoleLicenseOrganizationOfficialId('urn:org:tax:A12345678')).toBe('A12345678');
  });

  it('builds the canonical ledger organization id as urn:org:*', () => {
    expect(buildLedgerOrganizationId('TAX', 'VATES-B12345678'))
      .toBe('urn:org:tax:VATES-B12345678');
  });

  it('resolves the canonical ledger organization id from claims', () => {
    expect(resolveLedgerOrganizationId({
      [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
      [ClaimsOrganizationSchemaorg.identifierValue]: 'acme-id',
    } as any)).toBe('urn:org:tax:acme-id');
  });

  it('normalizes legacy fallback ids to the canonical ledger URN', () => {
    expect(resolveLedgerOrganizationId(undefined, 'TAX|legacy-acme'))
      .toBe('urn:org:tax:legacy-acme');
  });
});
