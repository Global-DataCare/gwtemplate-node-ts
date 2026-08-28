#!/usr/bin/env node
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { canonicalJson } from './lib/canonical-json.mjs';
import { validateDecision } from './lib/decision.mjs';
import { verifyControllerJws, verifyOperatorIdentityToken } from './lib/jws.mjs';
import { buildPlan } from './lib/planner.mjs';

function parseArgs(argv) {
  const result = { apply: false, maxAttempts: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') result.apply = true;
    else if (arg === '--decision') result.decision = argv[++index];
    else if (arg === '--did-document') result.didDocument = argv[++index];
    else if (arg === '--inventory') result.inventory = argv[++index];
    else if (arg === '--identity-jwks') result.identityJwks = argv[++index];
    else if (arg === '--driver') result.driver = argv[++index];
    else if (arg === '--state') result.state = argv[++index];
    else if (arg === '--audit') result.audit = argv[++index];
    else if (arg === '--max-attempts') result.maxAttempts = Number(argv[++index]);
    else throw new Error(`Unknown argument "${arg}".`);
  }
  for (const required of ['decision', 'didDocument', 'inventory', 'identityJwks']) {
    if (!result[required]) throw new Error(`--${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required.`);
  }
  if (result.apply && (!result.driver || !result.state || !result.audit)) {
    throw new Error('--apply requires --driver, --state and --audit.');
  }
  if (!Number.isSafeInteger(result.maxAttempts) || result.maxAttempts < 1 || result.maxAttempts > 10) {
    throw new Error('--max-attempts must be an integer from 1 to 10.');
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function runDriver(driver, mode, step) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolve(driver), [mode], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FABRIC_RECONCILER_MODE: mode },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Driver ${mode} failed (${code}): ${stderr.trim()}`));
      try {
        const output = JSON.parse(stdout);
        if (typeof output.satisfied !== 'boolean') throw new Error('missing boolean satisfied');
        resolvePromise(output);
      } catch (error) {
        reject(new Error(`Driver ${mode} returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.end(`${JSON.stringify(step)}\n`);
  });
}

async function loadState(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { specVersion: 'gdc.fabric.reconciler-state/v1', requests: {} };
    throw error;
  }
}

async function saveState(path, state) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, absolute);
}

async function audit(path, event) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await appendFile(absolute, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

async function applyPlan(options, envelope, verification, plan) {
  const state = await loadState(options.state);
  const existing = state.requests[plan.requestId];
  if (existing && existing.decisionDigest !== verification.digest) {
    throw new Error('requestId was already used with a different signed decision.');
  }
  const requestState = existing || {
    decisionDigest: verification.digest,
    planDigest: plan.digest,
    completedSteps: {},
  };
  if (requestState.planDigest !== plan.digest) throw new Error('Stored plan digest does not match current plan.');
  state.requests[plan.requestId] = requestState;

  for (const step of plan.steps) {
    if (requestState.completedSteps[step.id]) continue;
    const before = await runDriver(options.driver, 'inspect', step);
    if (!before.satisfied) {
      let lastError;
      for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
        try {
          await audit(options.audit, {
            at: new Date().toISOString(),
            requestId: plan.requestId,
            decisionDigest: verification.digest,
            controllerKid: envelope.decision.governance.controllerKid,
            operatorSubject: envelope.decision.operator.subject,
            stepId: step.id,
            stepType: step.type,
            target: step.target,
            attempt,
            status: 'applying',
          });
          await runDriver(options.driver, 'apply', step);
          const after = await runDriver(options.driver, 'inspect', step);
          if (!after.satisfied) throw new Error('post-apply inspection is not satisfied');
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          await audit(options.audit, {
            at: new Date().toISOString(),
            requestId: plan.requestId,
            stepId: step.id,
            attempt,
            status: 'retryable-failure',
            error: error.message,
          });
        }
      }
      if (lastError) throw lastError;
    }
    requestState.completedSteps[step.id] = { at: new Date().toISOString() };
    await saveState(options.state, state);
    await audit(options.audit, {
      at: new Date().toISOString(),
      requestId: plan.requestId,
      stepId: step.id,
      stepType: step.type,
      target: step.target,
      status: before.satisfied ? 'already-satisfied' : 'completed',
    });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const [envelope, didDocument, inventory, identityJwks] = await Promise.all([
    readJson(options.decision),
    readJson(options.didDocument),
    readJson(options.inventory),
    readJson(options.identityJwks),
  ]);
  if (
    !envelope?.decision
    || typeof envelope?.approval?.jws !== 'string'
    || typeof envelope?.authentication?.jwt !== 'string'
  ) {
    throw new Error('Decision envelope requires decision, approval.jws and authentication.jwt.');
  }
  const verification = validateDecision(envelope.decision, inventory);
  const authenticatedOperator = verifyOperatorIdentityToken({
    jwt: envelope.authentication.jwt,
    jwks: identityJwks,
    expected: envelope.decision.operator,
    allowedAudiences: inventory.governance.identityAudiences,
  });
  const signature = await verifyControllerJws({
    jws: envelope.approval.jws,
    payload: canonicalJson(envelope.decision),
    didDocument,
    controllerDid: verification.controllerDid,
    controllerKid: verification.controllerKid,
  });
  const plan = buildPlan(envelope.decision, inventory);
  if (options.apply) await applyPlan(options, envelope, verification, plan);
  process.stdout.write(`${JSON.stringify({
    mode: options.apply ? 'apply' : 'plan',
    verified: true,
    signature,
    authenticatedOperator,
    decisionDigest: verification.digest,
    plan,
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`fabric-governance-reconciler: ${error.message}\n`);
    process.exitCode = 1;
  });
}
