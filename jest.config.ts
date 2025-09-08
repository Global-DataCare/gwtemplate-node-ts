// jest.config.ts

import type { JestConfigWithTsJest } from 'ts-jest';

const config: JestConfigWithTsJest = {
  testEnvironment: 'node',
  injectGlobals: true,   // make describe/it/expect/jest global
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Treat TS as ESM inside Jest so imports work
  extensionsToTreatAsEsm: ['.ts'],

  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/src/__tests__/old/'], // Exclude old tests

  // Important: we will transform .ts via ts-jest, and specific node_modules .js via babel-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.jest.json'
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
        '@noble/curves',
      ].join('|')
    }))`
  ],

  // If you added this before to strip .js endings, remove it. It can break ESM resolution.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@noble/post-quantum/ml-kem$': '<rootDir>/src/__tests__/mocks/noble-post-quantum.mock.ts'
  },  

  clearMocks: true,
  testTimeout: 12000,
  verbose: true
};

export default config;


