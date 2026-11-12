// Flow contract: GW CORE 1.26.0 preserves its security, correctness, portability and release contracts.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)

test('GW and CCAAS release images pin Node 26.13.0', async () => {
  const gatewayDockerfile = await readFile(new URL('Dockerfile', root), 'utf8')
  const gatewayStages = gatewayDockerfile.match(/^FROM node:26\.13\.0-alpine(?: AS builder)?$/gmu) ?? []
  assert.equal(gatewayStages.length, 2)
  assert.doesNotMatch(gatewayDockerfile, /^FROM node:(?:24|26)-alpine/gmu)

  const ccaasDockerfile = await readFile(new URL('chaincode/Dockerfile.ccaas', root), 'utf8')
  assert.match(ccaasDockerfile, /^FROM node:26\.13\.0-alpine$/mu)
  assert.doesNotMatch(ccaasDockerfile, /^FROM node:(?:24|26)-alpine$/mu)

  const consentCcaasDockerfile = await readFile(
    new URL('chaincode/consentaccess-sc-javascript/Dockerfile', root),
    'utf8',
  )
  const consentStages = consentCcaasDockerfile.match(/^FROM node:26\.13\.0(?: AS \S+)?$/gmu) ?? []
  assert.equal(consentStages.length, 4)
  assert.doesNotMatch(consentCcaasDockerfile, /^FROM node:18/mu)
})

test('production dependencies exclude the Firebase rules test harness', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.dependencies['@firebase/rules-unit-testing'], undefined)
  assert.equal(manifest.devDependencies['@firebase/rules-unit-testing'], '^5.0.2')
  assert.equal(manifest.dependencies['firebase-admin'], '^14.5.0')
  assert.equal(manifest.dependencies['@google-cloud/storage'], '^8.4.0')
  assert.equal(manifest.dependencies['google-auth-library'], '^11.3.3')
  assert.equal(manifest.overrides['@google-cloud/firestore'], '9.4.0')
  assert.equal(manifest.overrides['google-gax'], '6.16.0')
  assert.equal(manifest.overrides['retry-request'], '9.1.0')
  assert.equal(manifest.overrides['teeny-request'], '11.1.1')
  assert.equal(manifest.overrides['fast-xml-parser'], '5.12.0')

  const ccaasManifest = JSON.parse(await readFile(
    new URL('chaincode/organization-sc-javascript/package.json', root),
    'utf8',
  ))
  assert.equal(ccaasManifest.overrides['@grpc/grpc-js'], '1.14.7')
  assert.equal(ccaasManifest.overrides.protobufjs, '7.6.6')

  const consentCcaasManifest = JSON.parse(await readFile(
    new URL('chaincode/consentaccess-sc-javascript/package.json', root),
    'utf8',
  ))
  assert.equal(consentCcaasManifest.overrides['@grpc/grpc-js'], '1.14.7')
  assert.equal(consentCcaasManifest.overrides.protobufjs, '7.6.6')
})

test('gateway build entrypoints are portable across Windows, macOS and Linux', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.scripts.clean, 'node scripts/clean-build.mjs')
  assert.equal(manifest.scripts['build:swagger'], 'node scripts/generate-swagger-all.mjs')
  assert.doesNotMatch(manifest.scripts.build, /rm -rf/u)
  assert.doesNotMatch(manifest.scripts['build:swagger'], /TS_NODE_[A-Z_]+=/u)
  for (const scriptName of ['test', 'test:unit', 'test:integration', 'test:e2e']) {
    assert.match(manifest.scripts[scriptName], /^node scripts\/run-jest\.mjs/u)
    assert.doesNotMatch(manifest.scripts[scriptName], /^NODE_OPTIONS=/u)
  }
  assert.equal(manifest.scripts['api:local-demo'], 'node scripts/run-local-api.mjs .env.local-demo')
  assert.equal(manifest.scripts['api:local-fabric'], 'node scripts/run-local-api.mjs .env.local-fabric')
  assert.equal(manifest.scripts['api:local-fabric-devnet'], 'npm run api:local-fabric')
  assert.equal(manifest.scripts['local:close'], 'node scripts/local-close.mjs')
  assert.doesNotMatch(manifest.scripts['api:local-demo'], /TS_NODE_[A-Z_]+=/u)
  assert.doesNotMatch(manifest.scripts['api:local-fabric'], /if \[/u)
  await access(new URL('scripts/clean-build.mjs', root))
  await access(new URL('scripts/generate-swagger-all.mjs', root))
  await access(new URL('scripts/run-jest.mjs', root))
  await access(new URL('scripts/run-local-api.mjs', root))
  await access(new URL('scripts/run-ts-api.mjs', root))
  await access(new URL('scripts/local-close.mjs', root))

  const consentManifest = JSON.parse(await readFile(
    new URL('chaincode/consentaccess-sc-javascript/package.json', root),
    'utf8',
  ))
  assert.equal(
    consentManifest.scripts.metadata,
    'fabric-chaincode-node metadata generate --file metadata.json',
  )
})

test('local Fabric environment binds ICA verification to the host jurisdiction', async () => {
  const script = await readFile(new URL('scripts/prepare-consentaccess-local-fabric-env.sh', root), 'utf8')
  assert.match(script, /^ICA_JURISDICTION=\$\{HOST_JURISDICTION_VALUE\}$/mu)

  const backendGenerator = await readFile(
    new URL('infra/fabric/local-network/scripts/04-generate-backend-env.sh', root),
    'utf8',
  )
  const escapedPemReplacement = String.raw`perl -0pe 's/\r?\n/chr(92) . "n"/ge' "$1"`
  assert.match(script, new RegExp(escapedPemReplacement.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(backendGenerator, new RegExp(escapedPemReplacement.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
})

test('consent-access deploy checks the Docker daemon instead of a Linux-only host socket', async () => {
  const script = await readFile(new URL('chaincode/scripts/consentaccess-local-devnet.sh', root), 'utf8')
  assert.match(script, /docker info >\/dev\/null 2>&1/u)
  assert.doesNotMatch(script, /-S \/var\/run\/docker\.sock/u)
})

test('local Fabric reset streams its shell program instead of passing it through Windows argv quoting', async () => {
  const script = await readFile(new URL('scripts/bootstrap-local-fabric-stack.mjs', root), 'utf8')
  const resetStep = script.slice(
    script.indexOf("runStep('fabric-reset-devnet'"),
    script.indexOf('if (config.fabricCaSource'),
  )
  assert.match(resetStep, /args: \['-s'\]/u)
  assert.match(resetStep, /input: \[/u)
  assert.doesNotMatch(resetStep, /'-lc'/u)
})

test('local Fabric selects Git Bash on Windows and keeps shell entrypoints on LF', async () => {
  const script = await readFile(new URL('scripts/bootstrap-local-fabric-stack.mjs', root), 'utf8')
  const attributes = await readFile(new URL('.gitattributes', root), 'utf8')
  assert.match(script, /const bashCommand = resolveBashCommand\(\)/u)
  assert.match(script, /const npmCommand = process\.platform === 'win32' \? process\.execPath : 'npm'/u)
  assert.match(script, /node_modules', 'npm', 'bin', 'npm-cli\.js'/u)
  assert.match(script, /const npxCommand = process\.platform === 'win32' \? process\.execPath : 'npx'/u)
  assert.match(script, /node_modules', 'npm', 'bin', 'npx-cli\.js'/u)
  assert.match(script, /command: bashCommand/u)
  assert.doesNotMatch(script, /command: 'bash'/u)
  assert.doesNotMatch(script, /command: '(?:npm|npx)'/u)
  assert.match(script, /MSYS_NO_PATHCONV: '1'/u)
  assert.match(script, /MSYS2_ARG_CONV_EXCL: '\*'/u)
  assert.match(attributes, /^\*\.sh text eol=lf$/mu)

  const envPreparationStep = script.slice(
    script.indexOf("runStep('gw-prepare-local-fabric-env'"),
    script.indexOf('if (config.deployChaincode)'),
  )
  assert.match(envPreparationStep, /command: bashCommand/u)
  assert.match(envPreparationStep, /args: \['\.\/scripts\/prepare-consentaccess-local-fabric-env\.sh'\]/u)

  const consentSmoke = await readFile(
    new URL('scripts/smoke-consentaccess-local-network.sh', root),
    'utf8',
  )
  assert.match(consentSmoke, /function strip_carriage_returns\(\)/u)
  assert.match(consentSmoke, /jq -r '\.\[\]' <<<"\$\{rule_ids_json\}" \| strip_carriage_returns/u)
})
