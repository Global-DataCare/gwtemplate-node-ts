import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Flow contract:
 * 1. GW projects one clinical resource into its existing subject-scoped record.
 * 2. `__digitalTwinSearch.text`, `.date` and `.language` coexist only on that
 *    same private projected record; they do not create a second collection.
 * 3. Composition-wide discovery may consume them internally, but search and
 *    materialization never return them as FHIR claims or clinical free text.
 */
describe('digital twin private search-field documentation contract', () => {
  const projectionSource = readFileSync(
    resolve(process.cwd(), 'src/utils/digital-twin-research-projection.ts'),
    'utf8',
  );
  const projectionTest = readFileSync(
    resolve(process.cwd(), 'src/__tests__/unit/utils/digital-twin-research-projection.test.ts'),
    'utf8',
  );
  const lifecycle101 = readFileSync(
    resolve(process.cwd(), 'docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md'),
    'utf8',
  );
  const capabilityMatrix = readFileSync(
    resolve(process.cwd(), 'docs/90.F-UC_CAPABILITY_MATRIX_SEDIA.md'),
    'utf8',
  );
  const owningSkill = readFileSync(
    resolve(process.cwd(), '.codex/skills/govern-digital-twin-consent/SKILL.md'),
    'utf8',
  );

  it('keeps the same-record, private-only boundary explicit in every teaching layer', () => {
    for (const text of [projectionSource, projectionTest, lifecycle101, capabilityMatrix, owningSkill]) {
      expect(text).toContain('same projected resource record');
      expect(text).toContain('not a separate collection');
    }
    expect(projectionSource).toContain('never public FHIR claims');
    expect(lifecycle101).toContain('digitaltwin_medications_<subject-hash>/documents/<medication-id>');
    expect(lifecycle101).toContain('__digitalTwinSearch.text');
    expect(lifecycle101).toContain('__digitalTwinSearch.date');
    expect(lifecycle101).toContain('__digitalTwinSearch.language');
  });
});
