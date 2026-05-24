// src/__tests__/data/consent-rules.data.ts

const testConsentSubject = 'did:web:api.acme.org:individual:123';

export const testConsentRulePermitOrgDid = {
  id: 'rule-org',
  '@context': 'org.hl7.fhir.api',
  'Consent.subject': testConsentSubject,
  'Consent.identifier': 'urn:uuid:rule-org',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'did:web:api.acme.org',
  'Consent.actor-role': 'ISCO-08|2211',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
  'Consent.date': '2026-05-20',
} as const;

export const testConsentRulePermitJurisdiction = {
  id: 'rule-jurisdiction',
  '@context': 'org.hl7.fhir.api',
  'Consent.subject': testConsentSubject,
  'Consent.identifier': 'urn:uuid:rule-jurisdiction',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'urn:iso:3166:ES',
  'Consent.actor-role': 'ISCO-08|2211',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
  'Consent.date': '2026-05-20',
} as const;

export const testConsentRulePermitEmailWildcardRole = {
  id: 'rule-email',
  '@context': 'org.hl7.fhir.api',
  'Consent.subject': testConsentSubject,
  'Consent.identifier': 'urn:uuid:rule-email',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'doctor1@acme.org',
  'Consent.actor-role': '*',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
  'Consent.date': '2026-05-20',
} as const;

export const testConsentRulePermitOrgDidMultiRole = {
  ...testConsentRulePermitOrgDid,
  id: 'rule-org-multirole',
  'Consent.identifier': 'urn:uuid:rule-org-multirole',
  'Consent.actor-role': 'ISCO-08|2211,ISCO-08|2212',
} as const;
