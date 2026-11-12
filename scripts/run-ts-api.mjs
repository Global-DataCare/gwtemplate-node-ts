// Flow contract: start the TypeScript API with one portable Node child and the approved compiler environment.
import { spawn } from 'node:child_process'

const child = spawn(
  process.execPath,
  [
    '--loader',
    'ts-node/esm',
    '--experimental-specifier-resolution=node',
    'src/main.ts',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_NODE_TRANSPILE_ONLY: '1',
      TS_NODE_SKIP_IGNORE: '1',
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        allowImportingTsExtensions: true,
      }),
    },
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`ERROR: unable to start the local TypeScript API: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
