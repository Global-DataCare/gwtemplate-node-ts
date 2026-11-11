import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_E9_SUITES = Object.freeze([
  'common-coverage', 'sdk-core', 'sdk-front', 'sdk-node-unit',
  'sdk-node-gw-and-consent', 'sdk-node-full-cycle', 'sdk-node-controller',
  'sdk-node-profile-individual', 'sdk-node-profile-professional',
  'ica-api', 'ica-client-isolated', 'ica-client-live', 'gw-runtime',
]);

/** Read completed Jest or Node test summaries, including sequential journeys. */
export function readTestCounters(raw) {
  const text = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
  const counters = { total: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, pending: 0 };
  const jest = [...text.matchAll(/^Tests:\s*(.+)$/gm)].at(-1);
  if (jest) {
    const fields = { total: 'total', passed: 'passed', failed: 'failed', skipped: 'skipped', todo: 'pending' };
    for (const match of jest[1].matchAll(/(\d+)\s+(total|passed|failed|skipped|todo)/g)) {
      counters[fields[match[2]]] = Number(match[1]);
    }
  } else {
    const fields = { tests: 'total', pass: 'passed', fail: 'failed', skipped: 'skipped', cancelled: 'cancelled', todo: 'pending' };
    for (const match of text.matchAll(/^[ℹ#]\s*(tests|pass|fail|skipped|cancelled|todo)\s+(\d+)\s*$/gm)) {
      counters[fields[match[1]]] += Number(match[2]);
    }
  }
  return counters;
}

/** Fail closed on missing journeys, failed commands, omissions or invented totals. */
export function verifyE9Evidence(manifest, evidenceDir) {
  const errors = [];
  const suites = Array.isArray(manifest?.suites) ? manifest.suites : [];
  const seen = new Set();
  for (const id of REQUIRED_E9_SUITES) {
    if (!suites.some((suite) => suite.id === id)) errors.push(`missing suite: ${id}`);
  }
  for (const suite of suites) {
    const prefix = String(suite?.id || '<missing id>');
    if (seen.has(prefix)) errors.push(`${prefix}: duplicate suite`);
    seen.add(prefix);
    if (suite.exitCode !== 0) errors.push(`${prefix}: exitCode must be 0`);
    if (suite.node !== 'v26.13.0') errors.push(`${prefix}: runtime must be Node v26.13.0`);
    if (!suite.source?.repository || !suite.source?.version || !/^[0-9a-f]{40}$/.test(suite.source?.commit || '')) {
      errors.push(`${prefix}: exact repository, version and commit required`);
    }
    if (!Array.isArray(suite.command) || !suite.command.length || suite.command.some((arg) => typeof arg !== 'string')) {
      errors.push(`${prefix}: exact command required`);
    }
    const declared = suite.tests || {};
    if (!Number.isInteger(declared.total) || declared.total <= 0 || declared.passed !== declared.total) {
      errors.push(`${prefix}: every declared test must pass`);
    }
    for (const field of ['failed', 'skipped', 'cancelled', 'pending']) {
      if (declared[field] !== 0) errors.push(`${prefix}: ${field} must be 0`);
    }
    try {
      const base = path.resolve(evidenceDir);
      const logPath = path.resolve(base, suite.log?.path || '');
      if (!logPath.startsWith(base + path.sep)) throw new Error('log path outside evidence directory');
      const bytes = readFileSync(logPath);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== suite.log?.sha256) errors.push(`${prefix}: log sha256 mismatch`);
      const observed = readTestCounters(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (Object.keys(observed).some((key) => observed[key] !== declared[key])) {
        errors.push(`${prefix}: declared counters disagree with completed log summaries`);
      }
    } catch (error) { errors.push(`${prefix}: ${error.message}`); }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifestPath = path.resolve(process.argv[2] || '');
    const errors = verifyE9Evidence(JSON.parse(readFileSync(manifestPath, 'utf8')), path.dirname(manifestPath));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('E9 local: all required suites passed; zero failures, skips or pending tests; log hashes and counters verified.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
