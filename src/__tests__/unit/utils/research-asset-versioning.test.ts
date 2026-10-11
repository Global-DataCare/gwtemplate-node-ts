// Flow contract: register a code-only ResearchAsset before its opaque VersionAsset, and mark only the version asset with research=true.
import { VitalSignsCodes } from 'gdc-common-utils-ts/constants/vital-signs';
import {
  buildResearchAssetVersionMapping,
  resolveResearchDataChannel,
} from '../../../utils/research-asset-versioning';

describe('research asset versioning', () => {
  it('builds stable opaque ids without putting labels or the source version id in the ledger payload', () => {
    const input = {
      resourceType: 'Observation',
      sourceResourceId: '6d9ac6c2-ec3b-4c82-8aa6-e4e0fc120001',
      sourceVersionId: 'zResearchSourceVersionMustRemainPrivate',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: {
        'Observation.code': VitalSignsCodes.BodyTemperature.claim,
        'Observation.code-text': 'Temperatura corporal',
        'Observation.code-display': VitalSignsCodes.BodyTemperature.display,
      },
    };

    const first = buildResearchAssetVersionMapping(input);
    const replay = buildResearchAssetVersionMapping(input);

    expect(first).toEqual(replay);
    expect(first.researchAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.versionAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.versionAssetId).not.toBe(first.sourceVersionId);
    expect(first.parent).toBe(first.researchAssetId);
    expect(first.research).toBe(true);
    expect(first.tags).toEqual([{
      id: 'Observation.code',
      system: VitalSignsCodes.BodyTemperature.system,
      code: VitalSignsCodes.BodyTemperature.code,
    }]);
    expect(JSON.stringify(first)).not.toContain('Temperatura corporal');
    expect(JSON.stringify(first)).not.toContain(VitalSignsCodes.BodyTemperature.display);
  });

  it('refuses to build a ResearchAsset when the clinical resource has no canonical code', () => {
    expect(() => buildResearchAssetVersionMapping({
      resourceType: 'MedicationStatement',
      sourceResourceId: '6d9ac6c2-ec3b-4c82-8aa6-e4e0fc120002',
      sourceVersionId: 'zUncodedMedicationVersion',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: { 'MedicationStatement.code-text': 'Extemporaneous medicinal product' },
    })).toThrow('canonical system|code');
  });

  it('derives the research channel only from trusted sector and jurisdiction', () => {
    const previous = process.env.NETWORK_MODE;
    try {
      process.env.NETWORK_MODE = 'test';
      expect(resolveResearchDataChannel('health-care', 'ES')).toBe('health-care-eu-research');
      process.env.NETWORK_MODE = 'local-network';
      expect(resolveResearchDataChannel('animal-care', 'CA-BC')).toBe('animal-care-local-research');
    } finally {
      if (previous === undefined) delete process.env.NETWORK_MODE;
      else process.env.NETWORK_MODE = previous;
    }
  });
});
