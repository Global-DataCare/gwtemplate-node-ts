// Flow contract: public guidance keeps coded research projection, terminology, authorship, and user-selection boundaries distinct.
import { readFileSync } from 'fs';
import path from 'path';

describe('research summary documentation contract', () => {
  const repositoryFile = (relativePath: string) => readFileSync(
    path.join(process.cwd(), relativePath),
    'utf8',
  );

  it.each([
    'README.md',
    'docs-v1/01-OVERVIEW-AND-GUIDES/01.I-LIFECYCLE.md',
  ])('keeps %s at the observable application contract', (relativePath) => {
    const publicGuide = repositoryFile(relativePath);
    expect(publicGuide).toContain('system|code');
    expect(publicGuide).toMatch(/removes.*received.*display.*text/is);
    expect(publicGuide).toMatch(/terminology service.*system\|code/is);
    expect(publicGuide).toMatch(/userSelected.*(?:chose|chosen).*not.*patient.*professional/is);
    expect(publicGuide).toMatch(/self-reported.*professional clinical.*never reveals the author/is);
    expect(publicGuide).not.toContain('__digitalTwinSearch');
    expect(publicGuide).not.toContain('indexed.attributes');
  });

  it('keeps implementation boundaries in the repository skill', () => {
    const operationalSkill = repositoryFile('.codex/skills/govern-digital-twin-consent/SKILL.md');
    expect(operationalSkill).toContain('<Resource>.code = system|code');
    expect(operationalSkill).toMatch(/remove.*received.*code-display.*code-text/is);
    expect(operationalSkill).toMatch(/terminology.*re-resolve.*standardized/is);
    expect(operationalSkill).toMatch(/Remove.*author.*attester.*performer.*source.*research projection/is);
    expect(operationalSkill).toMatch(/Bare envelope\s+`status`/);
  });
});
