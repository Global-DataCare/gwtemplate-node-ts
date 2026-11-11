// Flow contract: E9 acceptance requires every declared suite, successful commands, exact log integrity and zero failed, skipped or pending tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REQUIRED_E9_SUITES, verifyE9Evidence } from '../verify-e9-evidence.mjs';

function fixture(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e9-contract-'));
  const log = 'ℹ tests 2\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n';
  const manifest = { suites: REQUIRED_E9_SUITES.map((id) => ({
    id, source: { repository: 'synthetic-test-fixture', version: '1.0.0', commit: 'a'.repeat(40) },
    node: 'v26.13.0', command: ['node', '--test', 'synthetic.test.mjs'], exitCode: 0,
    log: { path: id + '.log', sha256: createHash('sha256').update(log).digest('hex') },
    tests: { total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, pending: 0 },
  })) };
  for (const suite of manifest.suites) writeFileSync(path.join(dir, suite.log.path), log);
  try { run({ dir, manifest }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('accepts the complete successful matrix', () => fixture(({ dir, manifest }) => {
  assert.deepEqual(verifyE9Evidence(manifest, dir), []);
}));

test('rejects an unsuccessful command even when counters claim success', () => fixture(({ dir, manifest }) => {
  manifest.suites[0].exitCode = 1;
  assert.match(verifyE9Evidence(manifest, dir).join('\n'), /exitCode/);
}));

for (const field of ['failed', 'skipped', 'cancelled', 'pending']) {
  test(`rejects ${field} tests`, () => fixture(({ dir, manifest }) => {
    manifest.suites[0].tests[field] = 1;
    assert.match(verifyE9Evidence(manifest, dir).join('\n'), new RegExp(field));
  }));
}

test('rejects a missing suite instead of reducing the matrix', () => fixture(({ dir, manifest }) => {
  manifest.suites.pop();
  assert.match(verifyE9Evidence(manifest, dir).join('\n'), /missing/);
}));

test('rejects log modification', () => fixture(({ dir, manifest }) => {
  writeFileSync(path.join(dir, manifest.suites[0].log.path), 'changed');
  assert.match(verifyE9Evidence(manifest, dir).join('\n'), /sha256/);
}));

test('rejects invented counters even if the log hash is genuine', () => fixture(({ dir, manifest }) => {
  manifest.suites[0].tests.total = 100;
  manifest.suites[0].tests.passed = 100;
  assert.match(verifyE9Evidence(manifest, dir).join('\n'), /counters/);
}));

test('rejects a different runtime', () => fixture(({ dir, manifest }) => {
  manifest.suites[0].node = 'v24.0.0';
  assert.match(verifyE9Evidence(manifest, dir).join('\n'), /runtime/);
}));
