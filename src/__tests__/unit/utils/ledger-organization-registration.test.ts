import { describe, expect, it } from '@jest/globals';
import { isSameOrganizationCredentialIdentity } from '../../../utils/ledger-organization-registration';

describe('organization ledger credential retry identity', () => {
  // Detached JWS authenticates each payload independently. Reissued envelope
  // metadata is not a second legal organization when the signed meaning stays
  // unchanged.
  it('accepts reissued envelope metadata for the same signed subject', () => {
    const stable = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      issuer: 'did:web:host.example',
      credentialSubject: { id: 'did:web:tenant.example', legalName: 'Example Inc' },
    };
    expect(isSameOrganizationCredentialIdentity(
      { ...stable, id: 'urn:uuid:first', type: ['LegalPerson', 'VerifiableCredential'], validFrom: '2026-01-01', proof: { jws: 'first' } },
      { ...stable, id: 'urn:uuid:retry', type: ['VerifiableCredential', 'LegalPerson'], validFrom: '2026-01-02', proof: { jws: 'retry' } },
    )).toBe(true);
  });

  it('rejects a changed credential subject or issuer', () => {
    const original = {
      type: ['VerifiableCredential', 'LegalPerson'],
      issuer: 'did:web:host.example',
      credentialSubject: { id: 'did:web:tenant.example', legalName: 'Example Inc' },
    };
    expect(isSameOrganizationCredentialIdentity(original, {
      ...original,
      credentialSubject: { ...original.credentialSubject, legalName: 'Different Inc' },
    })).toBe(false);
    expect(isSameOrganizationCredentialIdentity(original, {
      ...original,
      issuer: 'did:web:other-host.example',
    })).toBe(false);
  });
});
