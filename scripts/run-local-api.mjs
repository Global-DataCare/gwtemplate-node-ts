// Flow contract: load one explicit local profile, regenerate OpenAPI, and supervise the API portably.
import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parse } from 'dotenv'

const envFileArgument = process.argv[2]
if (!envFileArgument) {
  console.error('ERROR: local API requires an explicit environment file.')
  process.exit(1)
}

const envFile = resolve(envFileArgument)
try {
  await access(envFile)
} catch {
  console.error(`ERROR: missing local API environment file: ${envFile}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0 && !signal) resolveRun()
      else rejectRun(new Error(`${command} exited with ${signal ?? code}`))
    })
  })
}

await run(process.execPath, ['scripts/generate-swagger-all.mjs'])

const profile = parse(await readFile(envFile))
const childEnv = { ...profile, ...process.env }
const require = createRequire(import.meta.url)
const nodemon = require.resolve('nodemon/bin/nodemon.js')
const execCommand = 'node scripts/run-ts-api.mjs'
const child = spawn(
  process.execPath,
  [
    nodemon,
    '--legacy-watch',
    '--watch',
    'src/**/*.ts',
    '--watch',
    'swagger.config.cjs',
    '--exec',
    execCommand,
  ],
  { stdio: 'inherit', env: childEnv },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`ERROR: unable to start local API supervisor: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
