// TDD contract: write this test red first; make it green only with the complete real behavior.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildEvidenceManifest } from '../build-open-source-evidence-manifest.mjs';

test('manifest separates host MSP membership from VAT-addressed tenants', () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'open-source-evidence-'));
  mkdirSync(join(evidenceDir, 'gates'));
  writeFileSync(join(evidenceDir, 'gates', 'runtime.status'), 'PASS\n');
  writeFileSync(join(evidenceDir, 'runtime.log'), 'synthetic evidence\n');

  const manifest = buildEvidenceManifest({
    evidenceDir,
    imageName: 'gw-core:test',
    now: new Date('2026-08-24T00:00:00.000Z'),
    imageInspector: (name) => ({
      name,
      id: 'sha256:test',
      repoDigests: [],
      platform: 'linux/amd64',
    }),
  });

  assert.deepEqual(manifest.localNetwork.fabricMembers, ['Host1MSP', 'Host2MSP']);
  assert.match(manifest.localNetwork.tenantBoundary, /not Fabric MSPs/);
  assert.equal(manifest.productionChannelProjection.euOrganizationsAndEmployees, 'identity-eu');
  assert.equal(manifest.productionChannelProjection.humanIndividuals, 'identity-global');
  assert.match(manifest.productionChannelProjection.excludedScope, /animal/);
  assert.equal(manifest.gates[0].status, 'PASS');
  assert.match(manifest.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal('privateKey' in manifest, false);
});
