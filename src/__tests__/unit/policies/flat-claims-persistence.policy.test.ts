// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Claims-first managers must persist the canonical flat claim map and may materialize native FHIR only at an explicit adapter boundary.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('claims-first persistence policy', () => {
  it('makes the storage invariant and its executable manager gate explicit', () => {
    const root = process.cwd();
    const skill = readFileSync(resolve(root, '.codex/skills/enforce-release-test-discipline/SKILL.md'), 'utf8');
    const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');

    // These exact phrases are the policy surface under test, not duplicated business fixtures.
    for (const contract of [skill, agents]) {
      expect(contract).toMatch(/resource\.meta\.claims.*canonical.*source of truth/is);
      expect(contract).toMatch(/content\.claims.*protectConfidentialData/is);
      expect(contract).toMatch(/indexed\.attributes.*protectAttributesNameAndValue/is);
      expect(contract).toMatch(/native FHIR.*explicit.*projection.*export/is);
      expect(contract).toMatch(/test.*argument.*protectConfidentialData.*reject.*nested/is);
    }
  });
});
