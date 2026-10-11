// Flow contract: secondary-use consent rebuilds only finalized, professionally attested clinical records and never promotes personal records into the research repository.
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
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
  const professionalProvenance = {
    'Composition.attester': 'PractitionerRole/clinician-1',
    'Composition.attester-mode': 'professional',
  };

  it('does not project before an explicit secondary-use permit', async () => {
    const vaultRepository = new VaultMemRepository();
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
  });

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
        'Composition.status': 'final',
        ...professionalProvenance,
      },
      {
        id: 'legacy-composition-vitals',
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': 'urn:uuid:ips-001',
        'Composition.subject': sourceSubject,
        'Composition.section': 'LOINC|8716-3',
        'Composition.type': 'LOINC|60591-5',
        'Composition.status': 'final',
        ...professionalProvenance,
      },
    ], sourceCompositionSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'medication-001',
      '@context': 'org.hl7.fhir.r4',
      'MedicationStatement.identifier': 'urn:uuid:medication-001',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code': 'http://snomed.info/sct|108575001',
      indexed: { versionId: 'zPrivateMedicationVersion' },
      'Composition.section': 'LOINC|10160-0',
      ...professionalProvenance,
    }, {
      id: 'medication-personal',
      '@context': 'org.hl7.fhir.r4',
      'MedicationStatement.identifier': 'urn:uuid:medication-personal',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code-text': 'Personal medication report',
      'Composition.attester': 'RelatedPerson/family-1',
      'Composition.attester-mode': 'personal',
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

    const blockchainAdapter = {
      readSubjectIdentifierPayloads: jest.fn(async () => []),
      registerResearchVersionMappings: jest.fn(async (mappings: any[]) => ({ accepted: mappings.length })),
    } as any;
    const warnings: any[] = [];
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
      sector: 'health-care',
      jurisdiction: 'ES',
      blockchainAdapter,
      warnings,
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
    expect(blockchainAdapter.registerResearchVersionMappings).toHaveBeenCalledWith(
      [expect.objectContaining({
        resourceType: 'MedicationStatement',
        research: true,
        tags: [{
          id: 'MedicationStatement.code',
          system: 'http://snomed.info/sct',
          code: '108575001',
        }],
      })],
      'health-care-eu-research',
      'artifact-sc',
    );
    expect(warnings).toEqual([]);
  });

  it('keeps a consent rebuild successful and returns a warning when research registration is unavailable', async () => {
    const vaultRepository = new VaultMemRepository();
    await vaultRepository.put(tenantVaultId, [{
      id: 'medication-warning',
      'MedicationStatement.identifier': 'urn:uuid:medication-warning',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code': 'http://snomed.info/sct|108575001',
      indexed: { versionId: 'zPrivateMedicationWarningVersion' },
      ...professionalProvenance,
    }], getSubjectScopedSectionId(sourceSubject, 'individual', 'medications'));
    const warnings: any[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(applyDigitalTwinSecondaryUseDecision({
        vaultRepository,
        tenantVaultId,
        claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
        sector: 'health-care',
        jurisdiction: 'ES',
        blockchainAdapter: {
          readSubjectIdentifierPayloads: jest.fn(async () => []),
          registerResearchVersionMappings: jest.fn(async () => { throw new Error('ledger unavailable'); }),
        },
        warnings,
      })).resolves.toBe(true);
      expect(warnings).toEqual([expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ severity: 'warning', code: 'processing' })],
      })]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps a consent rebuild successful, warns, and skips ledger registration when terminology labels are unavailable', async () => {
    const vaultRepository = new VaultMemRepository();
    await vaultRepository.put(tenantVaultId, [{
      id: 'medication-terminology-warning',
      'MedicationStatement.identifier': 'urn:uuid:medication-terminology-warning',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code': 'http://snomed.info/sct|108575001',
      indexed: { versionId: 'zPrivateMedicationTerminologyWarningVersion' },
      ...professionalProvenance,
    }], getSubjectScopedSectionId(sourceSubject, 'individual', 'medications'));
    const blockchainAdapter = {
      readSubjectIdentifierPayloads: jest.fn(async () => []),
      registerResearchVersionMappings: jest.fn(async (mappings: any[]) => ({ accepted: mappings.length })),
    } as any;
    const warnings: any[] = [];
    const previousEnabled = process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
    const previousUrl = process.env.RESEARCH_TERMINOLOGY_BASE_URL;
    const previousFetch = global.fetch;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'true';
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    global.fetch = jest.fn(async () => { throw new Error('terminology unavailable'); }) as any;
    try {
      await expect(applyDigitalTwinSecondaryUseDecision({
        vaultRepository,
        tenantVaultId,
        claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
        sector: 'health-care',
        jurisdiction: 'ES',
        blockchainAdapter,
        warnings,
      })).resolves.toBe(true);
      expect(blockchainAdapter.registerResearchVersionMappings).not.toHaveBeenCalled();
      expect(warnings).toEqual([expect.objectContaining({
        resourceType: 'OperationOutcome',
        issue: [expect.objectContaining({ severity: 'warning', code: 'processing' })],
      })]);
    } finally {
      errorSpy.mockRestore();
      global.fetch = previousFetch;
      if (previousEnabled === undefined) delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
      else process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = previousEnabled;
      if (previousUrl === undefined) delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      else process.env.RESEARCH_TERMINOLOGY_BASE_URL = previousUrl;
    }
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
      'Composition.status': 'final',
      ...professionalProvenance,
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

  it('keeps projection enabled while another portal or study still permits use', async () => {
    const vaultRepository = new VaultMemRepository();
    const consentSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'consents');
    await vaultRepository.put(tenantVaultId, [{
      id: 'study-b',
      ...baseClaims,
      [ClaimConsent.sourceReference]: 'urn:study:b',
      [ClaimConsent.decision]: 'permit',
    }], consentSection);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: 'https://portal.example/research',
        [ClaimConsent.decision]: 'deny',
      },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(true);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: 'urn:study:b',
        [ClaimConsent.decision]: 'deny',
      },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
  });
});
