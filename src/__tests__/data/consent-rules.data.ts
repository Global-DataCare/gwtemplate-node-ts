// TDD contract: write this test red first; make it green only with the complete real behavior.
// src/__tests__/data/consent-rules.data.ts
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { HealthcareActorRoles, HealthcareConsentActions, HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SUBJECT_DID } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';

const testConsentSubject = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SUBJECT_DID;

export const testConsentRulePermitOrgDid = {
  id: 'rule-org',
  '@context': 'org.hl7.fhir.api',
  [ClaimConsent.subject]: testConsentSubject,
  [ClaimConsent.identifier]: 'urn:uuid:rule-org',
  [ClaimConsent.decision]: 'permit',
  [ClaimConsent.actorIdentifier]: 'did:web:api.acme.org',
  [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
  [ClaimConsent.action]: HealthcareConsentActions.AllergiesAndIntolerances,
  [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
  [ClaimConsent.date]: '2026-05-20',
} as const;

export const testConsentRulePermitJurisdiction = {
  id: 'rule-jurisdiction',
  '@context': 'org.hl7.fhir.api',
  [ClaimConsent.subject]: testConsentSubject,
  [ClaimConsent.identifier]: 'urn:uuid:rule-jurisdiction',
  [ClaimConsent.decision]: 'permit',
  [ClaimConsent.actorIdentifier]: 'urn:iso:3166:ES',
  [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
  [ClaimConsent.action]: HealthcareConsentActions.AllergiesAndIntolerances,
  [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
  [ClaimConsent.date]: '2026-05-20',
} as const;

export const testConsentRulePermitEmailWildcardRole = {
  id: 'rule-email',
  '@context': 'org.hl7.fhir.api',
  [ClaimConsent.subject]: testConsentSubject,
  [ClaimConsent.identifier]: 'urn:uuid:rule-email',
  [ClaimConsent.decision]: 'permit',
  [ClaimConsent.actorIdentifier]: 'doctor1@acme.org',
  [ClaimConsent.actorRole]: '*',
  [ClaimConsent.action]: HealthcareConsentActions.AllergiesAndIntolerances,
  [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
  [ClaimConsent.date]: '2026-05-20',
} as const;

export const testConsentRulePermitOrgDidMultiRole = {
  ...testConsentRulePermitOrgDid,
  id: 'rule-org-multirole',
  [ClaimConsent.identifier]: 'urn:uuid:rule-org-multirole',
  [ClaimConsent.actorRole]: `${HealthcareActorRoles.Physician},ISCO-08|2212`,
} as const;
