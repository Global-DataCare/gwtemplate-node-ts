#!/usr/bin/env node
// Flow contract: run Jest through the approved Node executable with portable environment assignment on every supported OS.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const testEnvArg = args.find((arg) => arg.startsWith('--test-env='))
const jestArgs = args.filter((arg) => !arg.startsWith('--test-env='))
const jest = fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url))
const env = { ...process.env }
if (testEnvArg) env.TEST_ENV = testEnvArg.slice('--test-env='.length)

const result = spawnSync(
  process.execPath,
  ['--experimental-vm-modules', jest, ...jestArgs],
  { cwd: process.cwd(), env, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
