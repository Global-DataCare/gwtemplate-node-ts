// Flow contract: entrypoint docs and the research skill keep isolated statistics, study twins, tenant imports and verified clinical sources as distinct data planes.
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('research data-plane documentation contract', () => {
  const skill = read('.codex/skills/govern-digital-twin-consent/SKILL.md');
  const entrypoints = [
    read('docs-v1/00-READING_ORDER.md'),
    read('docs-v2/00-quickstart.md'),
  ];

  it('prevents an isolated statistical report from implicitly creating or joining a digital twin', () => {
    expect(skill).toContain('Isolated public statistics');
    expect(skill).toMatch(/must never\s+create, update or join a Digital Twin/);
    expect(skill).toContain('independent explicit actions');
  });

  it.each(entrypoints)('teaches all four research-related planes at the documentation entrypoint', (entrypoint) => {
    expect(entrypoint).toContain('Isolated public statistics');
    expect(entrypoint).toContain('Study-specific Digital Twin');
    expect(entrypoint).toContain('Private tenant research import');
    expect(entrypoint).toContain('Verified clinical source');
    expect(entrypoint).toContain('ResearchStudy');
    expect(entrypoint).toContain('SOSChain');
    expect(entrypoint).toContain('Fundación UNID');
    expect(entrypoint).toContain('Connect Health Personal');
    expect(entrypoint).toContain('PetChain');
    expect(entrypoint).toContain('UHC');
    expect(entrypoint).toContain('VetChain');
    expect(entrypoint).toContain('Connect Health Professional');
  });
});
