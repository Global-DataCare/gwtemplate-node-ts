import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import {
  applyDigitalTwinSecondaryUseDecision,
  isDigitalTwinSecondaryUseEnabled,
  purgeDigitalTwinSubjectLink,
} from '../../../utils/digital-twin-secondary-use';
import {
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isDigitalTwinSubjectId,
  isRegisteredDigitalTwinSubjectId,
} from '../../../utils/digital-twin-research-projection';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('digital twin secondary-use lifecycle', () => {
  const tenantVaultId = 'health-care_acme';
  const sourceSubject = 'did:web:api.acme.org:individual:subject-001';
  const baseClaims = {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.subject]: sourceSubject,
    [ClaimConsent.purpose]: HealthcareConsentPurposes.Research,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
  };

  it('accepts only UUID URNs registered by the tenant alias vault', async () => {
    const vaultRepository = new VaultMemRepository();
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });

    expect(isDigitalTwinSubjectId(twinSubjectId)).toBe(true);
    expect(isDigitalTwinSubjectId(sourceSubject)).toBe(false);
    expect(await isRegisteredDigitalTwinSubjectId({ vaultRepository, tenantVaultId, twinSubjectId })).toBe(true);
    expect(await isRegisteredDigitalTwinSubjectId({
      vaultRepository,
      tenantVaultId,
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000999',
    })).toBe(false);
  });

  it('disables synchronization without deleting the published twin and rebuilds one multi-section Composition when re-enabled', async () => {
    const vaultRepository = new VaultMemRepository();
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });
    const sourceCompositionSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'composition');
    const sourceMedicationSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'medications');
    const twinCompositionSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition');
    const twinMedicationSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');

    await vaultRepository.put(tenantVaultId, [
      {
        id: 'legacy-composition-medications',
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': 'urn:uuid:ips-001',
        'Composition.subject': sourceSubject,
        'Composition.section': 'LOINC|10160-0',
        'Composition.type': 'LOINC|60591-5',
      },
      {
        id: 'legacy-composition-vitals',
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': 'urn:uuid:ips-001',
        'Composition.subject': sourceSubject,
        'Composition.section': 'LOINC|8716-3',
        'Composition.type': 'LOINC|60591-5',
      },
    ], sourceCompositionSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'medication-001',
      '@context': 'org.hl7.fhir.r4',
      'MedicationStatement.identifier': 'urn:uuid:medication-001',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code': 'http://snomed.info/sct|108575001',
      'Composition.section': 'LOINC|10160-0',
    }], sourceMedicationSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'published-before-withdrawal',
      'Composition.subject': twinSubjectId,
      'Composition.section': 'LOINC|10160-0',
    }], twinCompositionSection);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'deny' },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, twinCompositionSection)).toHaveLength(1);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, sourceCompositionSection)).toHaveLength(2);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, getDigitalTwinSubjectAliasSectionId())).toHaveLength(1);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(true);
    const compositions = await vaultRepository.listContainersInSection<any>(tenantVaultId, twinCompositionSection);
    expect(compositions).toHaveLength(1);
    expect(String(compositions[0]['Composition.section']).split(',')).toEqual([
      'LOINC|10160-0',
      'LOINC|8716-3',
    ]);
    expect(compositions[0]['Composition.subject']).toBe(twinSubjectId);
    const medications = await vaultRepository.listContainersInSection<any>(tenantVaultId, twinMedicationSection);
    expect(medications).toHaveLength(1);
    expect(medications[0]['MedicationStatement.subject']).toBe(twinSubjectId);
  });

  it('purges only the private provider binding and allocates a new UUID after later enrollment', async () => {
    const vaultRepository = new VaultMemRepository();
    const oldTwinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });
    const sourceCompositionSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'composition');
    const oldTwinCompositionSection = getSubjectScopedSectionId(oldTwinSubjectId, 'digitaltwin', 'composition');
    await vaultRepository.put(tenantVaultId, [{
      id: 'ips-source',
      '@context': 'org.hl7.fhir.r4',
      'Composition.identifier': 'urn:uuid:ips-purge-test',
      'Composition.subject': sourceSubject,
      'Composition.section': 'LOINC|10160-0',
      'Composition.type': 'LOINC|60591-5',
    }], sourceCompositionSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'anonymous-twin-before-offboarding',
      'Composition.subject': oldTwinSubjectId,
      'Composition.section': 'LOINC|10160-0',
    }], oldTwinCompositionSection);

    const purge = await purgeDigitalTwinSubjectLink({ vaultRepository, tenantVaultId, sourceSubject });
    expect(purge).toEqual({ purged: true, detachedTwinSubjectId: oldTwinSubjectId });
    expect(await isRegisteredDigitalTwinSubjectId({ vaultRepository, tenantVaultId, twinSubjectId: oldTwinSubjectId })).toBe(false);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, oldTwinCompositionSection)).toHaveLength(1);
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
    });
    const aliases = await vaultRepository.listContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
    expect(aliases).toHaveLength(1);
    const newTwinSubjectId = aliases[0].twinSubjectId;
    expect(newTwinSubjectId).not.toBe(oldTwinSubjectId);
    expect(isDigitalTwinSubjectId(newTwinSubjectId)).toBe(true);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, oldTwinCompositionSection)).toHaveLength(1);
    expect(await vaultRepository.listContainersInSection(
      tenantVaultId,
      getSubjectScopedSectionId(newTwinSubjectId, 'digitaltwin', 'composition'),
    )).toHaveLength(1);
  });
});
