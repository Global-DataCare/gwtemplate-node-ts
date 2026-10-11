// Flow contract: admit only professionally attested clinical records to research, keep source labels private, and retain professional fallback labels only for an uncoded MedicationStatement.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import {
  DIGITAL_TWIN_SEARCH_DATE_CLAIM,
  DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
  DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isProfessionallyAttestedResearchRecord,
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

  it('accepts only a professional attester as clinical research provenance', () => {
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'PractitionerRole/clinician-1',
      'Composition.attester-mode': 'professional',
    })).toBe(true);
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'RelatedPerson/family-1',
      'Composition.attester-mode': 'personal',
    })).toBe(false);
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'PractitionerRole/untyped-1',
    })).toBe(false);
  });

  it('keeps a coded projection code-only and returns a warning when enabled terminology is unavailable', async () => {
    process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'true';
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await resolveAndProjectClaimsForDigitalTwin({
        resourceType: 'Observation', sector: 'health-care', jurisdiction: 'ES',
        twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        claims: {
          'Observation.code': 'http://loinc.org|8310-5',
          'Observation.code-text': 'Temperatura corporal',
          'Observation.code-display': 'Body temperature',
          'Composition.attester': 'PractitionerRole/clinician-1',
          'Composition.attester-mode': 'professional',
        },
      });
      expect(result.claims['Observation.code']).toBe('http://loinc.org|8310-5');
      expect(result.claims).not.toHaveProperty('Observation.code-text');
      expect(result.claims).not.toHaveProperty('Observation.code-display');
      expect(result.claims[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe('http://loinc.org|8310-5');
      expect(result.researchReady).toBe(false);
      expect(result.warning).toMatchObject({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'warning', code: 'processing' }],
      });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('keeps the original medication code-text as an explicit unreviewed fallback when code is absent', async () => {
    const result = await resolveAndProjectClaimsForDigitalTwin({
      resourceType: 'MedicationStatement', sector: 'health-care', jurisdiction: 'ES',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: {
        'MedicationStatement.subject': 'did:web:api.example:individual:123',
        'MedicationStatement.code-text': 'Ibuprofeno preparado para Alice',
        'MedicationStatement.user-selected': 'true',
        'MedicationStatement.language': 'es',
        'MedicationStatement.note': 'Call Alice on 555-0100',
        'Composition.attester': 'PractitionerRole/clinician-1',
        'Composition.attester-mode': 'professional',
      },
    });

    expect(result.claims['MedicationStatement.code']).toBeUndefined();
    expect(result.claims['MedicationStatement.code-text']).toBe('Ibuprofeno preparado para Alice');
    expect(result.claims['MedicationStatement.user-selected']).toBe('false');
    expect(result.claims).not.toHaveProperty('MedicationStatement.code-display');
    expect(result.claims).not.toHaveProperty('MedicationStatement.note');
    expect(result.claims[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe('Ibuprofeno preparado para Alice');
    expect(result.researchReady).toBe(false);
    expect(result.warning).toMatchObject({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'warning', code: 'incomplete' }],
    });
  });

  it('uses the professional display only when an uncoded medication has no local text', async () => {
    const result = await resolveAndProjectClaimsForDigitalTwin({
      resourceType: 'MedicationStatement', sector: 'health-care', jurisdiction: 'ES',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: {
        'MedicationStatement.subject': 'did:web:api.example:individual:123',
        'MedicationStatement.code-display': 'Extemporaneous medicinal product',
        'Composition.attester': 'PractitionerRole/clinician-1',
        'Composition.attester-mode': 'professional',
      },
    });

    expect(result.claims).not.toHaveProperty('MedicationStatement.code-text');
    expect(result.claims['MedicationStatement.code-display']).toBe('Extemporaneous medicinal product');
    expect(result.claims['MedicationStatement.user-selected']).toBe('false');
    expect(result.researchReady).toBe(false);
  });

  it('does not call terminology when host label enrichment is disabled and marks coded projection ready', async () => {
    process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'false';
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const result = await resolveAndProjectClaimsForDigitalTwin({
        resourceType: 'Observation', sector: 'health-care', jurisdiction: 'ES',
        twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        claims: {
          'Observation.code': 'http://loinc.org|8310-5',
          'Observation.code-text': 'Temperatura corporal',
          'Observation.code-display': 'Body temperature',
        },
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.claims).not.toHaveProperty('Observation.code-text');
      expect(result.claims).not.toHaveProperty('Observation.code-display');
      expect(result.researchReady).toBe(true);
      expect(result.warning).toBeUndefined();
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      fetchSpy.mockRestore();
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
