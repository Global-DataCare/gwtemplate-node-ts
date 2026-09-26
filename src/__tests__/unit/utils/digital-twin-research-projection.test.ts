// Flow contract: pseudonymize research facts, retain coded/date/category data, and never expose submitted labels or author identity.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import {
  DIGITAL_TWIN_SEARCH_DATE_CLAIM,
  DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
  DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isDigitalTwinResearchResourceType,
  projectClaimsForDigitalTwin,
  resolveAndProjectClaimsForDigitalTwin,
} from '../../../utils/digital-twin-research-projection';

/**
 * Flow contract: GW pseudonymizes one operational resource, removes its
 * identifying narrative and appends normalized searchable text,
 * clinical date and language to the same projected resource record. This is
 * not a separate collection, and those private properties never become FHIR
 * claims returned to a researcher.
 */
describe('digital twin research projection', () => {
  it('creates one private stable twin subject alias without persisting the operational DID', async () => {
    const records = new Map<string, any>();
    const vaultRepository = {
      get: jest.fn(async (_vaultId: string, id: string) => records.get(id)),
      put: jest.fn(async (_vaultId: string, items: any[]) => {
        items.forEach((item) => records.set(item.id, item));
        return true;
      }),
    } as any;

    const sourceSubject = 'did:web:api.acme.org:individual:123';
    const first = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId: 'health-care_acme', sourceSubject });
    const second = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId: 'health-care_acme', sourceSubject });

    expect(first).toBe(second);
    expect(first).toMatch(/^urn:uuid:/);
    expect(vaultRepository.put).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...records.values()])).not.toContain(sourceSubject);
    expect(getDigitalTwinSubjectAliasSectionId()).toContain('digitaltwin_subject_aliases');
  });

  it('keeps canonical code and trusted resolved labels while removing source labels and identifying narrative', () => {
    const twinSubjectId = 'urn:uuid:00000000-0000-4000-8000-000000000001';
    const projected = projectClaimsForDigitalTwin({
      resourceType: ResourceTypesFhirR4.MedicationStatement,
      twinSubjectId,
      claims: {
        '@context': 'org.hl7.fhir.r4',
        '@type': 'MedicationStatement:SelfReported',
        'MedicationStatement.identifier': 'clinical-medication-123',
        'MedicationStatement.author': 'did:web:api.acme.org:member:private-author',
        'MedicationStatement.attester': 'urn:uuid:private-attester',
        'MedicationStatement.information-source': 'PractitionerRole/private-source',
        'MedicationStatement.subject': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.patient': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.code': 'http://snomed.info/sct|387207008',
        'MedicationStatement.code-text': 'Private dictated wording',
        'MedicationStatement.dosage-instruction': 'Take after dinner',
        'MedicationStatement.code-display': 'Private source display',
        'MedicationStatement.effective-dateTime': '2026-08-20T10:30:00.000Z',
        'MedicationStatement.language': 'es',
        'MedicationStatement.medication-text': 'Alice takes ibuprofen',
        'MedicationStatement.note': 'Call Alice on 555-0100',
      },
      terminology: {
        codeClaim: 'MedicationStatement.code',
        textClaim: 'MedicationStatement.code-text',
        displayClaim: 'MedicationStatement.code-display',
        system: 'http://snomed.info/sct',
        code: '387207008',
        text: 'Ibuprofeno normalizado',
        display: 'Ibuprofen normalized',
        textLanguage: 'es',
        displayLanguage: 'en',
      },
    });

    expect(projected['MedicationStatement.subject']).toBe(twinSubjectId);
    expect(projected['MedicationStatement.identifier']).toMatch(/^urn:uuid:/);
    expect(projected['MedicationStatement.identifier']).not.toBe('clinical-medication-123');
    expect(projected['MedicationStatement.code']).toBe('http://snomed.info/sct|387207008');
    expect(projected['@type']).toBe('MedicationStatement:SelfReported');
    expect(Object.hasOwn(projected, 'MedicationStatement.author')).toBe(false);
    expect(Object.hasOwn(projected, 'MedicationStatement.attester')).toBe(false);
    expect(Object.hasOwn(projected, 'MedicationStatement.information-source')).toBe(false);
    expect(JSON.stringify(projected)).not.toContain('private-author');
    expect(JSON.stringify(projected)).not.toContain('private-attester');
    expect(JSON.stringify(projected)).not.toContain('private-source');
    expect(projected['MedicationStatement.code-text']).toBe('Ibuprofeno normalizado');
    expect(projected['MedicationStatement.code-display']).toBe('Ibuprofen normalized');
    expect(Object.hasOwn(projected, 'MedicationStatement.patient')).toBe(false);
    expect(Object.hasOwn(projected, 'MedicationStatement.dosage-instruction')).toBe(false);
    expect(Object.hasOwn(projected, 'MedicationStatement.medication-text')).toBe(false);
    expect(Object.hasOwn(projected, 'MedicationStatement.note')).toBe(false);
    expect(projected[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe(
      'http://snomed.info/sct|387207008\u001fIbuprofeno normalizado\u001fIbuprofen normalized',
    );
    expect(projected[DIGITAL_TWIN_SEARCH_DATE_CLAIM]).toBe('2026-08-20T10:30:00.000Z');
    expect(projected[DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM]).toBe('es');
    // The governed date/language helpers coexist with the preserved code
    // on the same projected resource record. The projection does not write a
    // second search document or a separate collection.
    expect(Object.keys(projected)).toEqual(expect.arrayContaining([
      'MedicationStatement.code',
      DIGITAL_TWIN_SEARCH_DATE_CLAIM,
      DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
    ]));
  });

  it('keeps a code-only projection when the configured terminology boundary is unavailable', async () => {
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const projected = await resolveAndProjectClaimsForDigitalTwin({
        resourceType: 'Observation', sector: 'health-care', jurisdiction: 'ES',
        twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        claims: {
          'Observation.code': 'http://loinc.org|8310-5',
          'Observation.code-text': 'texto no confiable',
          'Observation.code-display': 'untrusted display',
        },
      });
      expect(projected['Observation.code']).toBe('http://loinc.org|8310-5');
      expect(projected).not.toHaveProperty('Observation.code-text');
      expect(projected).not.toHaveProperty('Observation.code-display');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects identity-bearing resource families from the research plane', () => {
    expect(isDigitalTwinResearchResourceType('Patient')).toBe(false);
    expect(isDigitalTwinResearchResourceType('RelatedPerson')).toBe(false);
    expect(isDigitalTwinResearchResourceType('Consent')).toBe(false);
    expect(() => projectClaimsForDigitalTwin({
      resourceType: 'Patient',
      twinSubjectId: 'urn:uuid:test',
      claims: { 'Patient.identifier': '123' },
    })).toThrow("Resource type 'Patient' is not allowed");
  });
});
