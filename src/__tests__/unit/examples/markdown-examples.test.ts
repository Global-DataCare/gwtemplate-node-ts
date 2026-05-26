import { readFileSync } from 'fs';
import path from 'path';

import {
  FAMILY_ORDER_REQUEST,
  FAMILY_REGISTRATION_REQUEST,
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_REGISTRATION_REQUEST,
  SMART_TOKEN_REQUEST,
} from '../../data/example-payloads';

const ROOT = process.cwd();
const docExampleMaps = new Map<string, Record<string, unknown>>([
  [
    path.join(ROOT, 'docs/90.A-API_INTEGRATORS_GUIDE.md'),
    {
      ORGANIZATION_REGISTRATION_REQUEST,
      ORGANIZATION_ORDER_REQUEST,
      SMART_TOKEN_REQUEST,
      FAMILY_REGISTRATION_REQUEST,
      FAMILY_ORDER_REQUEST,
    },
  ],
  [
    path.join(ROOT, 'docs/02-API-AND-ENDPOINTS/02.C-CURL-TESTS.md'),
    {
      ORGANIZATION_REGISTRATION_REQUEST,
    },
  ],
]);

function stripJsonLineComments(input: string): string {
  return input
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

function extractJsonPayload(block: string): string {
  const shellMatch = block.match(/--data(?:-raw)?\s+'({[\s\S]*})'\s*(?:-i\b)?/m);
  if (shellMatch) return shellMatch[1];

  const trimmed = block.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  throw new Error('Unable to locate JSON payload in synced markdown example.');
}

function parseSyncedExampleBlock(block: string): unknown {
  const jsonLike = extractJsonPayload(block);
  const withoutComments = stripJsonLineComments(jsonLike);
  const normalized = withoutComments.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(normalized);
}

function extractSyncedExamples(markdown: string): Map<string, unknown> {
  const examples = new Map<string, unknown>();
  const markerRegex = /<!--\s*sync-example:\s*([A-Z0-9_]+)\s*-->\s*```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;

  for (const match of markdown.matchAll(markerRegex)) {
    const exampleName = match[1];
    const block = match[2];
    examples.set(exampleName, parseSyncedExampleBlock(block));
  }

  return examples;
}

describe('canonical markdown examples', () => {
  for (const [docPath, canonicalExamples] of docExampleMaps.entries()) {
    it(`keeps synced markdown payloads byte-aligned with GW fixtures for ${path.relative(ROOT, docPath)}`, () => {
      const markdown = readFileSync(docPath, 'utf8');
      const syncedExamples = extractSyncedExamples(markdown);

      expect(Array.from(syncedExamples.keys()).sort()).toEqual(Object.keys(canonicalExamples).sort());

      for (const [exampleName, expectedPayload] of Object.entries(canonicalExamples)) {
        expect(syncedExamples.get(exampleName)).toEqual(expectedPayload);
      }
    });
  }
});
