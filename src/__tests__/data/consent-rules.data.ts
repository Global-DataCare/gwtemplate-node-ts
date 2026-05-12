// src/__tests__/data/consent-rules.data.ts

export const testConsentRulePermitOrgDid = {
  id: 'rule-org',
  '@context': 'org.hl7.fhir.api',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'did:web:api.acme.org',
  'Consent.actor-role': 'ISCO-08|2211',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
} as const;

export const testConsentRulePermitOrgDidMultiRole = {
  id: 'rule-org-multi-role',
  '@context': 'org.hl7.fhir.api',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'did:web:api.acme.org',
  'Consent.actor-role': 'ISCO-08|2211,ISCO-08|2221',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
} as const;

export const testConsentRulePermitJurisdiction = {
  id: 'rule-jurisdiction',
  '@context': 'org.hl7.fhir.api',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'urn:iso:3166:ES',
  'Consent.actor-role': 'ISCO-08|2211',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
} as const;

export const testConsentRulePermitEmailWildcardRole = {
  id: 'rule-email',
  '@context': 'org.hl7.fhir.api',
  'Consent.decision': 'permit',
  'Consent.actor-identifier': 'doctor1@acme.org',
  'Consent.actor-role': '*',
  'Consent.action': 'LOINC|48765-2',
  'Consent.purpose': 'TREAT',
} as const;

