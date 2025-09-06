// jest.config.unit.ts

/** @type {import('ts-jest').JestConfigWithTsJest} */
  preset: 'ts-jest/presets/default-esm', // Use ESM preset
module.exports = {
  testEnvironment: 'node',
  
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/unit/**/*.test.ts'],
  
  bail: 1,
  clearMocks: true,
  testTimeout: 3000,
  forceExit: true,
  verbose: true,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },

};
