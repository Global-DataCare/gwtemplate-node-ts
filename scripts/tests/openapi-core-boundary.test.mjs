// Flow contract:
// 1. GW CORE publishes one complete runtime specification and two derived views.
// 2. The derived views are limited to the canonical flow and compatibility routes.
// 3. Product-specific extensions remain in downstream repositories and are not advertised by CORE.
// Authorization invariant: generated documentation cannot expand the runtime authorization surface.
// Persistence invariant: regenerating OpenAPI cannot recreate an extension artifact in this repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('GW CORE does not generate or advertise a product-extension OpenAPI profile', () => {
  const generator = fs.readFileSync(path.join(repositoryRoot, 'scripts/generate-openapi-profiles.mjs'), 'utf8');
  const server = fs.readFileSync(path.join(repositoryRoot, 'src/server.ts'), 'utf8');
  const extensionArtifact = path.join(repositoryRoot, 'docs/openapi-profiles/openapi-extension.json');

  assert.doesNotMatch(generator, /['"]extension['"]/);
  assert.doesNotMatch(server, /openapi-extension\.json/);
  assert.equal(fs.existsSync(extensionArtifact), false);
});
