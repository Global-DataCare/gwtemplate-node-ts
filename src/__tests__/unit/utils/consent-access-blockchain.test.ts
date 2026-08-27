// TDD contract: write this test red first; make it green only with the complete real behavior.
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { ClaimConsent, ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import { buildConsentRulePrimaryDocument } from '../../../utils/consent-access-blockchain';

function buildConsentEntry(actorRole: string): BundleEntry {
  return {
    type: 'Consent',
    resource: {
      resourceType: 'Consent',
      meta: {
        claims: {
          '@context': 'org.hl7.fhir.api',
          [ClaimConsent.subject]: 'did:web:api.example:individual:subject-001',
          [ClaimConsent.actorIdentifier]: 'did:web:api.example:employee:doctor',
          [ClaimConsent.actorRole]: actorRole,
          [ClaimConsent.decision]: ConsentDecisions.Permit,
          [ClaimConsent.purpose]: 'ETREAT',
        },
      },
    },
  } as BundleEntry;
}

describe('buildConsentRulePrimaryDocument', () => {
  it.each([
    ['ISCO-08|221', 'org.ilo.isco-08|221'],
    ['v3-RoleCode|RESPRSN', 'org.hl7.terminology.codesystem.v3-RoleCode|RESPRSN'],
  ])('keeps legacy and canonical role systems on the same rule id', (legacyRole, canonicalRole) => {
    const legacyId = buildConsentRulePrimaryDocument([buildConsentEntry(legacyRole)]).data[0]?.id;
    const canonicalId = buildConsentRulePrimaryDocument([buildConsentEntry(canonicalRole)]).data[0]?.id;

    expect(canonicalId).toBe(legacyId);
  });
});
