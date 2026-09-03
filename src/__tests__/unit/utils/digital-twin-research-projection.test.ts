// TDD contract: write this test red first; make it green only with the complete real behavior.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import {
  DIGITAL_TWIN_SEARCH_DATE_CLAIM,
  DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
  DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isDigitalTwinResearchResourceType,
  projectClaimsForDigitalTwin,
} from '../../../utils/digital-twin-research-projection';

/**
 * Flow contract: GW pseudonymizes one operational resource, removes its
 * identifying/free-text claims and appends normalized searchable text,
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

  it('removes free text and replaces identifiers and subject references consistently', () => {
    const twinSubjectId = 'urn:uuid:00000000-0000-4000-8000-000000000001';
    const projected = projectClaimsForDigitalTwin({
      resourceType: ResourceTypesFhirR4.MedicationStatement,
      twinSubjectId,
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'MedicationStatement.identifier': 'clinical-medication-123',
        'MedicationStatement.subject': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.patient': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.code': 'http://snomed.info/sct|387207008',
        'MedicationStatement.code-text': 'Ibuprofen',
        'MedicationStatement.dosage-instruction': 'Take after dinner',
        'MedicationStatement.code-display': 'Ibuprofen prescribed to Alice',
        'MedicationStatement.effective-dateTime': '2026-08-20T10:30:00.000Z',
        'MedicationStatement.language': 'es',
        'MedicationStatement.medication-text': 'Alice takes ibuprofen',
        'MedicationStatement.note': 'Call Alice on 555-0100',
      },
    });

    expect(projected['MedicationStatement.subject']).toBe(twinSubjectId);
    expect(projected['MedicationStatement.identifier']).toMatch(/^urn:uuid:/);
    expect(projected['MedicationStatement.identifier']).not.toBe('clinical-medication-123');
    expect(projected['MedicationStatement.code']).toBe('http://snomed.info/sct|387207008');
    // Digital-twin discovery must use the preserved token above; local/manual
    // CodeableConcept text is intentionally absent from the research plane.
    expect(projected).not.toHaveProperty('MedicationStatement.code-text');
    expect(projected).not.toHaveProperty('MedicationStatement.code-display');
    expect(projected).not.toHaveProperty('MedicationStatement.patient');
    expect(projected).not.toHaveProperty('MedicationStatement.dosage-instruction');
    expect(projected).not.toHaveProperty('MedicationStatement.medication-text');
    expect(projected).not.toHaveProperty('MedicationStatement.note');
    expect(projected[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe('Ibuprofen\u001fIbuprofen prescribed to Alice');
    expect(projected[DIGITAL_TWIN_SEARCH_DATE_CLAIM]).toBe('2026-08-20T10:30:00.000Z');
    expect(projected[DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM]).toBe('es');
    // These three private properties coexist with the preserved coded claims
    // on the same projected resource record. The projection does not write a
    // second search document or a separate collection.
    expect(Object.keys(projected)).toEqual(expect.arrayContaining([
      'MedicationStatement.code',
      DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
      DIGITAL_TWIN_SEARCH_DATE_CLAIM,
      DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
    ]));
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
