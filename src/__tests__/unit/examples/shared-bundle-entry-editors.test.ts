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
    const subjectDid = 'did:web:api.acme.org:individual:shared-editor-001';
    const sectionClaim = 'LOINC|60591-5';

    const bundle = new BundleEditor()
      .setBundleOperation(EmployeeBundleOperations.create)
      .setAllowedResourceType('AllergyIntolerance')
      .newEntry('allergy-001')
      .setClaim('AllergyIntolerance.identifier', 'urn:uuid:allergy-001')
      .setClaim('AllergyIntolerance.subject', subjectDid)
      .setClaim('AllergyIntolerance.code', 'SNOMEDCT|91936005')
      .setClaim('Composition.section', sectionClaim)
      .doneEntry()
      .newEntry('medication-001')
      .setResourceId('medication-001')
      .setClaim('MedicationStatement.identifier', 'urn:uuid:medication-001')
      .setClaim('MedicationStatement.subject', subjectDid)
      .setClaim('MedicationStatement.medication-text', 'Ibuprofen 400 mg')
      .setClaim('Composition.section', 'LOINC|10160-0')
      .doneEntry()
      .newEntry('condition-001')
      .setClaim('Condition.identifier', 'urn:uuid:condition-001')
      .setClaim('Condition.subject', subjectDid)
      .setClaim('Condition.code', 'SNOMEDCT|44054006')
      .setClaim('Composition.section', 'LOINC|11450-4')
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
        'AllergyIntolerance.subject': subjectDid,
        'Composition.section': sectionClaim,
      }),
    );
    expect(entries[1]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'MedicationStatement.identifier': 'urn:uuid:medication-001',
        'MedicationStatement.subject': subjectDid,
        'MedicationStatement.medication-text': 'Ibuprofen 400 mg',
      }),
    );
    expect(entries[2]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'Condition.identifier': 'urn:uuid:condition-001',
        'Condition.subject': subjectDid,
        'Condition.code': 'SNOMEDCT|44054006',
      }),
    );
  });
});
