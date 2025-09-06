/*
 * Jest Configuration
 * For a detailed explanation, see: https://jestjs.io/docs/configuration
 */

// jest.config.ts

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  // By using `projects`, we can run different test configurations in a single Jest run.
  // This is the recommended way to separate unit and integration tests.
  projects: [
    '<rootDir>/jest.config.unit.ts',
    '<rootDir>/jest.config.integration.ts',
  ],

  // Global settings that apply to all projects can be defined here.
  // For now, we keep the configuration decentralized in the project files.
  
  // We can also define a global coverage directory.
  coverageDirectory: 'coverage',
};
