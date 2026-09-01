// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Every portal must prove normal local UI -> BFF -> SDK -> GW in networkKind=test before Fabric, staging, or production.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('shared local-first portal release policy', () => {
  it('makes the immutable network progression and real-browser boundary explicit', () => {
    const root = process.cwd();
    const skill = readFileSync(resolve(root, '.codex/skills/enforce-release-test-discipline/SKILL.md'), 'utf8');
    const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const testingGuide = readFileSync(resolve(root, 'docs/TESTING.md'), 'utf8');
    for (const contract of [skill, agents, readme, testingGuide]) {
      expect(contract).toContain('test -> local-network -> test-network -> network');
      expect(contract).toMatch(/UI.*BFF.*SDK.*GW/s);
      expect(contract).toMatch(/Fixture.*mocked.*API-only/s);
      expect(contract).toMatch(/live.*E2E.*SKIP.*release/s);
      expect(contract).toMatch(/live.*E2E.*npm publish.*container image/s);
    }
  });
});
