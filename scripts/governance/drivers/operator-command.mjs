#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function runCommand(command, step, mode) {
  return new Promise((resolvePromise, reject) => {
    if (!Array.isArray(command) || !command.length || !isAbsolute(command[0])) {
      reject(new Error('Driver command must be a non-empty argv array with an absolute executable path.'));
      return;
    }
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FABRIC_RECONCILER_MODE: mode,
        FABRIC_RECONCILER_STEP_ID: step.id,
        FABRIC_RECONCILER_STEP_TYPE: step.type,
        FABRIC_RECONCILER_TARGET: step.target,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Operator command failed (${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const output = JSON.parse(stdout);
        if (typeof output.satisfied !== 'boolean') throw new Error('missing boolean satisfied');
        resolvePromise(output);
      } catch (error) {
        reject(new Error(`Operator command returned invalid JSON: ${error.message}`));
      }
    });
    child.stdin.end(`${JSON.stringify(step)}\n`);
  });
}

/**
 * Dispatches a verified reconciliation step to an operator-owned executable.
 * Commands come only from a local root-owned map, never from the signed
 * controller request. Invocation uses argv without a shell.
 */
async function main() {
  const mode = process.argv[2];
  if (mode !== 'inspect' && mode !== 'apply') throw new Error('Mode must be inspect or apply.');
  const commandMapPath = process.env.FABRIC_RECONCILER_COMMAND_MAP;
  if (!commandMapPath || !isAbsolute(commandMapPath)) {
    throw new Error('FABRIC_RECONCILER_COMMAND_MAP must be an absolute operator-owned file.');
  }
  const step = JSON.parse(await readStdin());
  const commandMap = JSON.parse(await readFile(resolve(commandMapPath), 'utf8'));
  if (commandMap.specVersion !== 'gdc.fabric.reconciler-driver-commands/v1') {
    throw new Error('Unsupported driver command map specVersion.');
  }
  const command = commandMap.targets?.[step.target]?.[step.type]?.[mode];
  if (!command) throw new Error(`No ${mode} command for ${step.target}/${step.type}.`);
  const result = await runCommand(command, step, mode);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`fabric-operator-command-driver: ${error.message}\n`);
  process.exitCode = 1;
});
