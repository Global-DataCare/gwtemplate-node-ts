// Flow contract: current SEDIA and architecture indexes expose closed evidence and isolate superseded material.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('current documentation source governance', () => {
  const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
  const readingOrder = read('docs/00-READING_ORDER.md');
  const docsIndex = read('docs/README.md');
  const matrix = read('docs/90.F-UC_CAPABILITY_MATRIX_SEDIA.md');

  it('presents the SEDIA matrix as closed implementation evidence', () => {
    expect(matrix).toContain('Status: Closed implementation evidence');
    expect(matrix).not.toMatch(/\b(?:missing|pending|partial|backlog|todo)\b/i);
    expect(matrix).toContain('PORTAL_API_TO_GW_CORE.md');
  });

  it('keeps superseded files out of the published documentation tree', () => {
    expect(readingOrder).toContain('recoverable from Git history');
    expect(docsIndex).not.toContain('legacy/');
    expect(existsSync(resolve(process.cwd(), 'docs/legacy'))).toBe(false);
  });

  it('keeps obsolete raw-email authorization identifiers outside current architecture examples', () => {
    const architecture = read('docs/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md');
    expect(architecture).toContain('urn:cds-es:v1:organization:tax:ES-B00112233');
    expect(architecture).not.toContain('urn:antifraud:test-network:cds-es');
    expect(architecture).not.toMatch(/:employee:[^\s`]*@/);
  });

  it('keeps the current docs-v2 set product-neutral and free of planning files', () => {
    const docsV2Root = resolve(process.cwd(), 'docs-v2');
    const names = readdirSync(docsV2Root).filter((name) => name.endsWith('.md'));
    expect(names).not.toEqual(expect.arrayContaining([
      '20-research-digital-twin-store-and-search-plan.md',
      '21-research-digital-twin-technical-backlog.md',
      '28-gdc-vetchain-network-boundaries.md',
      '99-migration-map-from-docs.md',
    ]));
    for (const name of names) {
      expect(readFileSync(resolve(docsV2Root, name), 'utf8'))
        .not.toMatch(/vetchain|petchain|\buhc\b|\bunid\b|dataconv|ResearchStudy/i);
    }
  });

  it('does not publish private product names in GW documentation', () => {
    const markdownPaths = ['README.md'];
    for (const root of ['docs', 'docs-v2', 'deliverables', 'docs-end']) {
      const entries = readdirSync(resolve(process.cwd(), root), {
        recursive: true,
        encoding: 'utf8',
      }) as string[];
      markdownPaths.push(...entries
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => `${root}/${entry}`));
    }
    for (const path of markdownPaths) {
      expect(read(path)).not.toMatch(/vetchain|petchain|\buhc\b|\bunid\b|dataconv/i);
    }
  });
});
