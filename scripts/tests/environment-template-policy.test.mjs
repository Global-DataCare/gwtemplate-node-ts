// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EnvironmentTemplateViolation,
  validateEnvironmentTemplateFiles,
  validateEnvironmentTemplateRepository,
} from '../validate-environment-template.mjs'

const SAFE_TEMPLATE = [
  'PUBLIC_BASE_URL=https://service.example',
  'CLIENT_SECRET=replace-in-ignored-env-file',
  '',
].join('\n')

test('accepts the one versioned template and ignored runtime environment contract', () => {
  assert.deepEqual(validateEnvironmentTemplateFiles({
    environmentTemplate: SAFE_TEMPLATE,
    gitignore: '.env*\n',
    legacyTemplateExists: false,
    legacyTemplateInstructionExists: false,
  }), [])
})

test('rejects the legacy filename, unignored runtime files and populated secrets', () => {
  assert.deepEqual(validateEnvironmentTemplateFiles({
    environmentTemplate: 'CLIENT_SECRET=real-secret-value\n',
    gitignore: '.env.local\n',
    legacyTemplateExists: true,
    legacyTemplateInstructionExists: true,
  }), [
    EnvironmentTemplateViolation.LegacyTemplate,
    EnvironmentTemplateViolation.RuntimeFilesNotIgnored,
    EnvironmentTemplateViolation.PopulatedSecret,
    EnvironmentTemplateViolation.LegacyTemplateInstruction,
  ])
})

test('keeps this repository compliant with the environment template contract', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  assert.deepEqual(validateEnvironmentTemplateRepository(repositoryRoot), [])
})
