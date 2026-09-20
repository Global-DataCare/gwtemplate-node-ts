// Flow contract: follow docs-v1/06-AUDIT-AND-EVIDENCE/06.C-LOCAL-FIRST-RELEASE-CONTRACT.md; start red, reuse canonical versioned-data/common-utils fixtures and standard types, and never duplicate governed literals.
// Every portal must prove normal local UI -> BFF -> SDK -> service in networkKind=test, including Playwright,
// before npm publication, Docker/Fabric local-network, staging, or production. An unpublished SDK may be installed
// temporarily from npm pack only to fail fast; it must never leave a file:/Git/workspace dependency or changed lockfile.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('shared local-first portal release policy', () => {
  it('makes the immutable network progression and real-browser boundary explicit', () => {
    const root = process.cwd();
    const skill = readFileSync(resolve(root, '.codex/skills/enforce-release-test-discipline/SKILL.md'), 'utf8');
    const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const testingGuide = readFileSync(resolve(root, 'docs-v1/06-AUDIT-AND-EVIDENCE/06.D-TESTING-GUIDE.md'), 'utf8');
    const localFirstContract = readFileSync(resolve(root, 'docs-v1/06-AUDIT-AND-EVIDENCE/06.C-LOCAL-FIRST-RELEASE-CONTRACT.md'), 'utf8');
    for (const contract of [skill, agents, readme, testingGuide]) {
      expect(contract).toContain('test -> local-network -> test-network -> network');
      expect(contract).toMatch(/UI.*BFF.*SDK.*(?:GW|service)/s);
      expect(contract).toMatch(/Fixture.*mocked.*API-only/s);
      expect(contract).toMatch(/live.*E2E.*SKIP.*release/s);
      expect(contract).toMatch(/live.*E2E.*npm publish.*container image/s);
      expect(contract).toMatch(/unit.*integration.*networkKind=test/is);
      expect(contract).toMatch(/UI.*BFF.*SDK.*(?:GW|service).*Playwright/is);
      expect(contract).toMatch(/npm pack.*temporary.*no-save.*restore.*lockfile/is);
      expect(contract).toMatch(/publish.*exact\s+registry\s+version.*local-network.*staging/is);
      expect(contract).toMatch(/resume.*failed gate.*predecessor.*state/is);
    }
    expect(readme).toContain('docs-v1/06-AUDIT-AND-EVIDENCE/06.C-LOCAL-FIRST-RELEASE-CONTRACT.md');
    expect(localFirstContract).toMatch(/red.*green.*refactor/is);
    expect(localFirstContract).toMatch(/HL7.*LOINC.*SNOMED.*ICD-10.*WHO ATC.*Schema\.org/is);
    expect(localFirstContract).toMatch(/versioned domain data package.*common-utils/is);
  });

  it('keeps npm authorization continuity explicit in every release-governing repository skill', () => {
    const skillsRoot = resolve(process.cwd(), '.codex/skills');
    const skillFiles = readdirSync(skillsRoot, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('SKILL.md'));
    const releaseSkillContracts = skillFiles
      .map((file) => readFileSync(resolve(skillsRoot, file), 'utf8'))
      .filter((contract) => contract.includes('Mandatory release authorization continuity'));
    expect(releaseSkillContracts.length).toBeGreaterThan(0);
    for (const contract of releaseSkillContracts) {
      expect(contract).toMatch(/three.*attempts.*five\s+minutes/is);
      expect(contract).toMatch(/npm pack.*tarball.*local.*test/is);
      expect(contract).toMatch(/registry.*publish.*consumer.*merge.*deploy/is);
      expect(contract).toMatch(/do not attempt.*npm publish.*every affected local.*unit.*integration.*local services.*real UI.*Playwright/is);
      expect(contract).toMatch(/resume only the smallest failed gate.*do not repeat a green\s+gate/is);
      expect(contract).toMatch(/exact registry version.*minimal\s+install\/export smoke.*do not repeat/is);
      expect(contract).toMatch(/HL7.*LOINC.*SNOMED.*ICD-10.*WHO ATC.*Schema\.org.*before.*invent/is);
      expect(contract).toMatch(/versioned domain data package.*common-utils.*shared package/is);
      expect(contract).toMatch(/gateway.*exact registry version.*image.*local-network.*portal.*tarball.*local-network.*exact registry version.*staging/is);
      expect(contract).toMatch(/unit.*integration.*networkKind=test/is);
      expect(contract).toMatch(/UI.*BFF.*SDK.*(?:GW|service).*Playwright/is);
      expect(contract).toMatch(/npm pack.*temporary.*no-save.*restore.*lockfile/is);
      expect(contract).toMatch(/publish.*exact\s+registry\s+version.*local-network.*staging/is);
      expect(contract).toMatch(/resume.*failed gate.*predecessor.*state/is);
    }
  });
});
