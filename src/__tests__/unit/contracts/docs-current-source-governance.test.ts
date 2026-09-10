// Flow contract: current SEDIA and architecture indexes expose closed evidence and isolate superseded material.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('current documentation source governance', () => {
  const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
  const readingOrder = read('docs-v1/00-READING_ORDER.md');
  const docsIndex = read('docs-v1/README.md');
  const matrix = read('docs-v1/06-AUDIT-AND-EVIDENCE/06.A-SEDIA-CAPABILITY-EVIDENCE-MATRIX.md');

  it('presents the SEDIA matrix as closed implementation evidence', () => {
    expect(matrix).toContain('Status: Closed implementation evidence');
    expect(matrix).not.toMatch(/\b(?:missing|pending|partial|backlog|todo)\b/i);
    expect(matrix).not.toMatch(/Research(?:Study|Subject)/i);
    expect(matrix).toMatch(/owning SDK\s+repositories/);
  });

  it('keeps superseded files out of the published documentation tree', () => {
    expect(readingOrder).toContain('recoverable from Git history');
    expect(docsIndex).not.toContain('legacy/');
    expect(existsSync(resolve(process.cwd(), 'docs-v1/legacy'))).toBe(false);
  });

  it('keeps obsolete raw-email authorization identifiers outside current architecture examples', () => {
    const architecture = read('docs-v1/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md');
    expect(architecture).toContain('urn:cds-es:v1:organization:tax:ES-B00112233');
    expect(architecture).not.toContain('urn:antifraud:test-network:cds-es');
    expect(architecture).not.toMatch(/:employee:[^\s`]*@/);
  });

  it('keeps both documentation versions continuously numbered', () => {
    const docsV1Root = resolve(process.cwd(), 'docs-v1');
    const topLevelMarkdown = readdirSync(docsV1Root)
      .filter((name) => name.endsWith('.md'))
      .sort();
    expect(topLevelMarkdown).toEqual([
      '00-READING_ORDER.md',
      'DOCS_GOVERNANCE.md',
      'README.md',
    ]);

    const docsV1Sections = [
      '01-OVERVIEW-AND-GUIDES',
      '02-API-AND-ENDPOINTS',
      '03-IDENTITY-AND-TRUST',
      '04-DEEP-DIVES',
      '05-USE-CASES',
      '06-AUDIT-AND-EVIDENCE',
    ];
    for (const section of docsV1Sections) {
      const prefix = section.slice(0, 2);
      const names = readdirSync(resolve(docsV1Root, section))
        .filter((name) => name.endsWith('.md'))
        .sort();
      const letters = names.map((name) => name.match(new RegExp(`^${prefix}\\.([A-Z])-`))?.[1]);
      expect(letters).not.toContain(undefined);
      expect(letters).toEqual(Array.from(
        { length: names.length },
        (_, index) => String.fromCharCode('A'.charCodeAt(0) + index),
      ));
      expect(names).not.toEqual(expect.arrayContaining([
        expect.stringMatching(/(?:old|todo|plan|blueprint|legacy)/i),
      ]));
    }

    const docsV2Root = resolve(process.cwd(), 'docs-v2');
    const names = readdirSync(docsV2Root)
      .filter((name) => /^\d{2}-.*\.md$/.test(name))
      .sort();
    expect(names.map((name) => Number(name.slice(0, 2))))
      .toEqual(Array.from({ length: 27 }, (_, index) => index));
    expect(names).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:plan|backlog|migration)/i),
    ]));
  });

  it('keeps public documentation and repository skills product-neutral', () => {
    const forbiddenProductPattern = new RegExp([
      'vet' + 'chain',
      'pet' + 'chain',
      'sos' + 'chain',
      'u' + 'hc',
      'u' + 'nid',
      'data' + 'conv',
      'acc' + 'uro',
    ].join('|'), 'i');

    const markdownFiles = (root: string): string[] => readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) return markdownFiles(path);
        return entry.name.endsWith('.md') ? [path] : [];
      });

    const roots = ['docs-v1', 'docs-v2', 'deliverables', 'docs-end', '.codex/skills'];
    for (const path of roots.flatMap((root) => markdownFiles(resolve(process.cwd(), root)))) {
      expect(readFileSync(path, 'utf8')).not.toMatch(forbiddenProductPattern);
    }

    for (const path of ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'NARRATIVE-ALIGNMENT.md', 'CHANGELOG.md']) {
      expect(read(path)).not.toMatch(forbiddenProductPattern);
    }
  });

});
