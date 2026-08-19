import { describe, expect, it } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { allowsLegacyRepresentativeBootstrap } from '../../../managers/hosting/legacy-representative-bootstrap-policy';

const claims = {
  [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G00000000',
  [ClaimsServiceSchemaorg.category]: 'onehealth-research',
};

const legacyCredential = {
  id: 'urn:example:credential:original',
  issuer: 'did:web:ica-original.example.test',
  type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
};

describe('allowsLegacyRepresentativeBootstrap', () => {
  it('scopes compatibility by tenant and sector without pinning credential, issuer or signer key', () => {
    const configuredScopes = 'VATES-G00000000|onehealth-research';
    expect(allowsLegacyRepresentativeBootstrap({
      claims,
      representativeCredential: legacyCredential,
      configuredScopes,
    })).toBe(true);
    expect(allowsLegacyRepresentativeBootstrap({
      claims,
      representativeCredential: {
        ...legacyCredential,
        id: 'urn:example:credential:renewed',
        issuer: 'did:web:another-trusted-ica.example.test',
      },
      configuredScopes,
    })).toBe(true);
  });

  it('rejects another tenant, sector or credential type', () => {
    const configuredScopes = 'VATES-G00000000|onehealth-research';
    expect(allowsLegacyRepresentativeBootstrap({
      claims: { ...claims, [ClaimsServiceSchemaorg.category]: 'another-sector' },
      representativeCredential: legacyCredential,
      configuredScopes,
    })).toBe(false);
    expect(allowsLegacyRepresentativeBootstrap({
      claims,
      representativeCredential: { ...legacyCredential, type: ['VerifiableCredential'] },
      configuredScopes,
    })).toBe(false);
  });

  it('fails closed for malformed scope configuration', () => {
    expect(() => allowsLegacyRepresentativeBootstrap({
      claims,
      representativeCredential: legacyCredential,
      configuredScopes: 'VATES-G00000000',
    })).toThrow("must use the '<tenantId>|<sector>' format");
  });
});
