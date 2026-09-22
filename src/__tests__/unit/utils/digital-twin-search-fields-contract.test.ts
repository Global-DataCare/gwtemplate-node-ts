// Flow contract: private search-field plumbing stays executable and skill-owned while public lifecycle guidance describes only observable behavior.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    resolve(process.cwd(), 'docs-v1/01-OVERVIEW-AND-GUIDES/01.I-LIFECYCLE.md'),
    'utf8',
  );
  const capabilityMatrix = readFileSync(
    resolve(process.cwd(), 'docs-v1/06-AUDIT-AND-EVIDENCE/06.A-SEDIA-CAPABILITY-EVIDENCE-MATRIX.md'),
    'utf8',
  );
  const owningSkill = readFileSync(
    resolve(process.cwd(), '.codex/skills/govern-digital-twin-consent/SKILL.md'),
    'utf8',
  );

  it('keeps the same-record boundary in technical evidence and out of the public lifecycle guide', () => {
    for (const text of [projectionSource, projectionTest, capabilityMatrix, owningSkill]) {
      expect(text).toContain('same projected resource record');
      expect(text).toContain('not a separate collection');
    }
    expect(projectionSource).toContain('never public FHIR claims');
    expect(lifecycle101).not.toContain('digitaltwin_medications_<subject-hash>');
    expect(lifecycle101).not.toContain('__digitalTwinSearch');
  });
});
