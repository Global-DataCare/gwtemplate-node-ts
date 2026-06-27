import { describe, expect, it } from '@jest/globals';
import { buildFhirResourceFromIndexedClaims } from '../../../utils/fhir-resource-rehydration';
import { ResourceTypesFhirR4 } from '../../../shared/fhir-constants';

describe('fhir-resource-rehydration utils', () => {
  it('rehydrates MedicationStatement using shared resource-type constants and medication text/display claims', () => {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.MedicationStatement, {
      id: 'med-1',
      'MedicationStatement.subject': 'Patient/p-1',
      'MedicationStatement.identifier': 'medication-identifier',
      'MedicationStatement.status': 'active',
      'MedicationStatement.medication-text': 'Aspirin 100 mg',
      'MedicationStatement.CodeDisplay': 'Aspirin',
      'MedicationStatement.CodeTextLocal': 'Aspirina',
      'MedicationStatement.code': 'http://snomed.info/sct|123',
      'MedicationStatement.user-selected': 'true',
      'MedicationStatement.effectiveDateTime': '2026-01-01T00:00:00Z',
      'MedicationStatement.language': 'es',
    });

    expect(resource.resourceType).toBe(ResourceTypesFhirR4.MedicationStatement);
    expect(resource.subject).toEqual({ reference: 'Patient/p-1' });
    expect(resource.effectiveDateTime).toBe('2026-01-01T00:00:00Z');
    expect(resource.language).toBe('es');
    expect(resource.medicationCodeableConcept).toEqual({
      text: 'Aspirin 100 mg',
      coding: [{
        system: 'http://snomed.info/sct',
        code: '123',
        display: 'Aspirin',
        userSelected: true,
      }],
    });
  });

  it('rehydrates DocumentReference content and keeps subject/date semantics', () => {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DocumentReference, {
      id: 'doc-1',
      'DocumentReference.subject': 'Patient/p-1',
      'DocumentReference.identifier': 'document-identifier',
      'DocumentReference.contenttype': 'application/pdf',
      'DocumentReference.contenthash': 'cid-123',
      'DocumentReference.location': 'ipfs://cid-123',
      'DocumentReference.description': 'Clinical note',
      'DocumentReference.date': '2026-01-01T00:00:00Z',
    });

    expect(resource.resourceType).toBe(ResourceTypesFhirR4.DocumentReference);
    expect(resource.subject).toEqual({ reference: 'Patient/p-1' });
    expect(resource.date).toBe('2026-01-01T00:00:00Z');
    expect(resource.content).toEqual([{
      attachment: {
        contentType: 'application/pdf',
        url: 'ipfs://cid-123',
        id: 'cid-123',
      },
    }]);
  });
});
