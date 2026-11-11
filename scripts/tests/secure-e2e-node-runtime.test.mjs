// Flow contract: the secure E2E launcher accepts the repository's approved Node 26.13.0 runtime and rejects a different runtime before starting services.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../run-secure-e2e-google-user.sh', import.meta.url));
const bashCommand = process.platform === 'win32'
  ? [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ].find(existsSync) || 'bash'
  : 'bash';

for (const [version, accepted] of [['v26.13.0', true], ['v24.0.0', false], ['v26.12.0', false]]) {
  test(`secure E2E runtime guard ${accepted ? 'accepts' : 'rejects'} ${version}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'e9-runtime-'));
    try {
      const bin = path.join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
      // Exercise only the real runtime guard; the sentinel proves it was passed
      // without starting a local service or reading operator configuration.
      const source = readFileSync(launcher, 'utf8');
      const guard = source.slice(0, source.indexOf('\nresolve_sdk_root()'));
      const fixture = path.join(dir, 'guard.sh');
      writeFileSync(fixture, guard + '\nprintf "RUNTIME_ACCEPTED\\n"\n');
      const result = spawnSync(bashCommand, [fixture], {
        encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.equal(result.status, accepted ? 0 : 2, result.stderr);
      assert.equal(result.stdout.includes('RUNTIME_ACCEPTED'), accepted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
