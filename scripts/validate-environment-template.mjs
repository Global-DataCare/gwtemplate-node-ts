#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const EnvironmentTemplateViolation = Object.freeze({
  MissingTemplate: 'env.example is missing',
  LegacyTemplate: '.env.example must not be versioned',
  RuntimeFilesNotIgnored: '.gitignore must contain the exact .env* rule',
  PopulatedSecret: 'env.example contains a non-placeholder secret value',
  LegacyTemplateInstruction: 'documentation must not instruct users to copy .env.example',
})

const secretNamePattern = /(?:^|_)(?:API_KEY|AUTH_TOKEN|CLIENT_SECRET|CREDENTIALS?|PASS(?:WORD)?|PRIVATE_KEY|SECRET|SEED|TOKEN)(?:_|$)/
const placeholderValuePattern = /^(?:|<[^>]+>|\$\{[^}]+\}|(?:replace|example|dummy|placeholder|not[-_]?real|local[-_]?demo|test[-_]?only|dev[-_]?only|change[-_]?me)[A-Za-z0-9_./:@-]*)$/i
const nonSecretConfigurationNames = new Set([
  'AUTH_TOKEN_VERIFIER',
  'GOOGLE_APPLICATION_CREDENTIALS',
])

export function validateEnvironmentTemplateFiles({ environmentTemplate, gitignore, legacyTemplateExists, legacyTemplateInstructionExists = false }) {
  const violations = []
  if (legacyTemplateExists) {
    violations.push(EnvironmentTemplateViolation.LegacyTemplate)
  }
  if (!gitignore.split(/\r?\n/).includes('.env*')) {
    violations.push(EnvironmentTemplateViolation.RuntimeFilesNotIgnored)
  }

  const hasPopulatedSecret = environmentTemplate.split(/\r?\n/).some((line) => {
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!assignment || nonSecretConfigurationNames.has(assignment[1]) || !secretNamePattern.test(assignment[1])) return false
    return !placeholderValuePattern.test(assignment[2].trim())
  })
  if (hasPopulatedSecret) {
    violations.push(EnvironmentTemplateViolation.PopulatedSecret)
  }
  if (legacyTemplateInstructionExists) {
    violations.push(EnvironmentTemplateViolation.LegacyTemplateInstruction)
  }
  return violations
}

export function validateEnvironmentTemplateRepository(repositoryRoot) {
  const templatePath = resolve(repositoryRoot, 'env.example')
  if (!existsSync(templatePath)) {
    return [EnvironmentTemplateViolation.MissingTemplate]
  }
  return validateEnvironmentTemplateFiles({
    environmentTemplate: readFileSync(templatePath, 'utf8'),
    gitignore: readFileSync(resolve(repositoryRoot, '.gitignore'), 'utf8'),
    legacyTemplateExists: existsSync(resolve(repositoryRoot, '.env.example')),
    legacyTemplateInstructionExists: hasLegacyTemplateInstruction(repositoryRoot),
  })
}

function hasLegacyTemplateInstruction(repositoryRoot) {
  try {
    execFileSync('git', [
      '-C', repositoryRoot,
      'grep', '-l', '-E',
      'cp[[:space:]]+\\.env\\.example',
      '--', '*.md', 'package.json',
    ], { stdio: 'pipe' })
    return true
  } catch (error) {
    if (error?.status === 1) return false
    throw error
  }
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (executedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(process.argv[2] ?? '.')
  const violations = validateEnvironmentTemplateRepository(repositoryRoot)
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`)
    process.exitCode = 1
  }
}
