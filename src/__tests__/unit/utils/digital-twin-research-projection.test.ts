import {
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isDigitalTwinResearchResourceType,
  projectClaimsForDigitalTwin,
} from '../../../utils/digital-twin-research-projection';

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
      resourceType: 'MedicationStatement',
      twinSubjectId,
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'MedicationStatement.identifier': 'clinical-medication-123',
        'MedicationStatement.subject': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.patient': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.code': 'http://snomed.info/sct|387207008',
        'MedicationStatement.dosage-instruction': 'Take after dinner',
        'MedicationStatement.code-display': 'Ibuprofen prescribed to Alice',
        'MedicationStatement.medication-text': 'Alice takes ibuprofen',
        'MedicationStatement.note': 'Call Alice on 555-0100',
      },
    });

    expect(projected['MedicationStatement.subject']).toBe(twinSubjectId);
    expect(projected['MedicationStatement.identifier']).toMatch(/^urn:uuid:/);
    expect(projected['MedicationStatement.identifier']).not.toBe('clinical-medication-123');
    expect(projected['MedicationStatement.code']).toBe('http://snomed.info/sct|387207008');
    expect(projected).not.toHaveProperty('MedicationStatement.code-display');
    expect(projected).not.toHaveProperty('MedicationStatement.patient');
    expect(projected).not.toHaveProperty('MedicationStatement.dosage-instruction');
    expect(projected).not.toHaveProperty('MedicationStatement.medication-text');
    expect(projected).not.toHaveProperty('MedicationStatement.note');
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
