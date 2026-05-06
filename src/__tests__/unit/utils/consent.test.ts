import { buildConsentRuleKey, normalizeConsentActorRole } from '../../../utils/consent';

describe('consent utils', () => {
  it('normalizes country targets to FHIR ISO 3166 URN format', () => {
    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: 'es',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|urn:iso:std:iso:3166|ES|permit|TREAT');

    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: 'urn:iso:std:iso:3166|fr',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|urn:iso:std:iso:3166|FR|permit|TREAT');
  });

  it('normalizes phone target to canonical tel:+E164', () => {
    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: ' +34600111222 ',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|tel:+34600111222|permit|TREAT');
  });

  it('normalizes professional role formats to canonical ISCO-08', () => {
    expect(normalizeConsentActorRole('221', 'professional')).toBe('org.ilo.isco-08|221');
    expect(normalizeConsentActorRole('ISCO-08|221', 'professional')).toBe('org.ilo.isco-08|221');
    expect(normalizeConsentActorRole('org.ilo.isco-08|221', 'professional')).toBe('org.ilo.isco-08|221');
  });

  it('normalizes family role formats to canonical v3-RoleCode', () => {
    expect(normalizeConsentActorRole('RESPRSN', 'family')).toBe('v3-RoleCode|RESPRSN');
    expect(normalizeConsentActorRole('http://terminology.hl7.org/CodeSystem/v3-RoleCode|RESPRSN', 'family'))
      .toBe('v3-RoleCode|RESPRSN');
    expect(normalizeConsentActorRole('org.hl7.terminology.CodeSystem.v3-RoleCode|RESPRSN', 'family'))
      .toBe('v3-RoleCode|RESPRSN');
  });

  it('keeps wildcard role unchanged', () => {
    expect(normalizeConsentActorRole('*', 'professional')).toBe('*');
  });
});
