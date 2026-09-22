// Flow contract: public guides preserve source terminology evidence and explain code-based normalization without exposing storage plumbing.
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
    expect(publicGuide).toMatch(/display.*local text.*source\s+evidence/is);
    expect(publicGuide).toMatch(/not.*authoritative\s+terminology/is);
    expect(publicGuide).toMatch(/language matches.*terminology service.*international\s+display/is);
    expect(publicGuide).not.toContain('__digitalTwinSearch');
    expect(publicGuide).not.toContain('indexed.attributes');
  });

  it('keeps implementation boundaries in the repository skill', () => {
    const operationalSkill = repositoryFile('.codex/skills/govern-digital-twin-consent/SKILL.md');
    expect(operationalSkill).toContain('<Resource>.code = system|code');
    expect(operationalSkill).toMatch(/source\s+terminology evidence/is);
    expect(operationalSkill).toMatch(/must\s+not\s+treat either label as authoritative/is);
    expect(operationalSkill).toContain('Bare envelope `status`');
  });
});
