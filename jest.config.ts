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
  testPathIgnorePatterns: ['/node_modules/', '/src/__tests__/old/', 'snomed-ips.test.ts'], // Exclude old tests

  // Important: we will transform .ts via ts-jest, and specific node_modules .js via babel-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          // Override tsconfig.json for Jest
          module: 'ESNext',
          moduleResolution: 'bundler',
          // These are required for ESM support in ts-jest
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
        }
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

  clearMocks: true,
  testTimeout: 12000,
  verbose: true,

  // Coverage configuration
  collectCoverage: true,
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


