// jest.config.ts

import type { JestConfigWithTsJest } from 'ts-jest';

const isE2E = process.env.TEST_ENV === 'e2e';
const includeArtifacts = process.env.TEST_ARTIFACTS === '1';
const collectCoverage = process.env.COVERAGE === '1';

const config: JestConfigWithTsJest = {
  testEnvironment: 'node',
  injectGlobals: true,   // make describe/it/expect/jest global
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Treat TS as ESM inside Jest so imports work
  extensionsToTreatAsEsm: ['.ts'],

  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/__tests__/old/',
    'snomed-ips.test.ts',
    ...(includeArtifacts ? [] : ['/src/__tests__/artifacts/']),
    ...(isE2E ? [] : ['/src/__tests__/e2e/']),
    // Firestore integration tests require external services/credentials.
    '/src/__tests__/integration/repositories/firestore',
  ], // Exclude old tests and e2e by default

  // Important: we will transform .ts via ts-jest, and specific node_modules .js via babel-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
        },
      }
    ],
    '^.+\\.(mjs|js)$': 'babel-jest'
  },

  
  // By default, Jest ignores node_modules. This robust pattern uses a negative
  // lookahead to tell Jest to NOT ignore the specified ESM modules.
  transformIgnorePatterns: [
    `[/\\\\]node_modules[/\\\\](?!(${
      [
        '@noble/ciphers',
        '@noble/hashes',
        '@noble/post-quantum',
        '@noble/post-quantum/ml-dsa', // More specific path
        '@noble/post-quantum/ml-kem',  // More specific path        
        '@noble/curves',
        '@stablelib/utf8',
        '@stablelib/base64',        
        'pkijs',
        'asn1js',
        'uuid',
        '@peculiar/webcrypto'
      ].join('|')
    }))`
  ],

  // Allow TS ESM source files to import with .js specifiers (NodeNext style).
  // Jest/ts-jest resolves TS sources directly, so we strip the .js extension for relative imports.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
 

  clearMocks: true,
  watchman: false,
  testTimeout: 12000,
  verbose: true,

  // Coverage configuration
  collectCoverage,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/src/__tests__/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '\\.data\\.ts$',
  ],
};

export default config;
