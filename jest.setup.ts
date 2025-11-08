// jest.setup.ts
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables based on the test script being run.
// `npm run test:e2e` will set `process.env.TEST_ENV` to `e2e`.
if (process.env.TEST_ENV === 'e2e') {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  console.log('Jest setup: Loaded .env.test for E2E tests.');
} else {
  // For all other tests (unit, integration), load the standard .env file if it exists.
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

/* eslint-disable no-undef */

import * as globals from '@jest/globals';

// Re-expose Jest APIs as globals so old tests keep working
Object.assign(globalThis, globals);

jest.setTimeout(65000); // in milliseconds