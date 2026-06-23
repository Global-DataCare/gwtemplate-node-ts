import {
  EXAMPLE_CONDITION_CODE,
  EXAMPLE_CONDITION_IDENTIFIER,
  EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER,
  EXAMPLE_MEDICATION_STATEMENT_TEXT,
  EXAMPLE_SUBJECT_DID,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts';
import { BundleEditor, BundleEditableResourceTypes } from 'gdc-common-utils-ts/utils/bundle-editor';
import { BundleReader } from 'gdc-common-utils-ts/utils/bundle-reader';
import { EmployeeBundleOperations } from 'gdc-common-utils-ts/utils/employee';

describe('shared bundle entry editor surface in GW', () => {
  it('exposes typed shared entry editors only for vital signs/observations in the installed common-utils version', () => {
    const entry = new BundleEditor()
      .setBundleOperation(EmployeeBundleOperations.create)
      .setAllowedResourceType(BundleEditableResourceTypes.observation)
      .newEntry('observation-001');

    const runtimeEntry = entry as unknown as Record<string, unknown>;

    expect(typeof runtimeEntry.asVitalSign).toBe('function');
    expect(typeof runtimeEntry.asObservation).toBe('function');
    expect(typeof runtimeEntry.asAllergy).toBe('undefined');
    expect(typeof runtimeEntry.asMedicationUseStatement).toBe('undefined');
    expect(typeof runtimeEntry.asMedicationStatement).toBe('undefined');
    expect(typeof runtimeEntry.asCondition).toBe('undefined');
  });

  it('uses the generic entry editor for AllergyIntolerance, MedicationStatement, and Condition bundle claims today', () => {
    const bundle = new BundleEditor()
      .setBundleOperation(EmployeeBundleOperations.create)
      .setAllowedResourceType(ResourceTypesFhirR4.AllergyIntolerance)
      .newEntry('allergy-001')
      .setClaim('AllergyIntolerance.identifier', 'urn:uuid:allergy-001')
      .setClaim('AllergyIntolerance.subject', EXAMPLE_SUBJECT_DID)
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      )
      .doneEntry()
      .newEntry('medication-001')
      .setResourceId('medication-001')
      .setClaim('MedicationStatement.identifier', EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER)
      .setClaim('MedicationStatement.subject', EXAMPLE_SUBJECT_DID)
      .setClaim('MedicationStatement.medication-text', EXAMPLE_MEDICATION_STATEMENT_TEXT)
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      )
      .doneEntry()
      .newEntry('condition-001')
      .setClaim('Condition.identifier', EXAMPLE_CONDITION_IDENTIFIER)
      .setClaim('Condition.subject', EXAMPLE_SUBJECT_DID)
      .setClaim('Condition.code', EXAMPLE_CONDITION_CODE)
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.ProblemList.attributeValue,
      )
      .doneEntry()
      .build();

    const reader = new BundleReader(bundle);

    expect(reader.getTotalOperations()).toBe(3);
    expect(bundle.entry).toHaveLength(3);

    const entries = reader.getEntries() as Array<{
      resource?: {
        meta?: {
          claims?: Record<string, unknown>;
        };
      };
    }>;

    expect(entries[0]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'AllergyIntolerance.identifier': 'urn:uuid:allergy-001',
        'AllergyIntolerance.subject': EXAMPLE_SUBJECT_DID,
        'Composition.section': HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      }),
    );
    expect(entries[1]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'MedicationStatement.identifier': EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER,
        'MedicationStatement.subject': EXAMPLE_SUBJECT_DID,
        'MedicationStatement.medication-text': EXAMPLE_MEDICATION_STATEMENT_TEXT,
      }),
    );
    expect(entries[2]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'Condition.identifier': EXAMPLE_CONDITION_IDENTIFIER,
        'Condition.subject': EXAMPLE_SUBJECT_DID,
        'Condition.code': EXAMPLE_CONDITION_CODE,
      }),
    );
  });
});
