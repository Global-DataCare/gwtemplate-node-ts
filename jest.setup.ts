// jest.setup.ts
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables based on the test script being run.
// `npm run test:e2e` will set `process.env.TEST_ENV` to `e2e`.
if (process.env.TEST_ENV === 'e2e') {
  const envPath = path.resolve(__dirname, '.env.test');
  const result = dotenv.config({ path: envPath, override: true });
  
  if (result.error) {
    console.error('Jest setup: ERROR loading .env.test', result.error);
  } else {
    console.log(`Jest setup: Loaded .env.test for E2E tests. Found ${Object.keys(result.parsed || {}).length} variables.`);
  }
} else {
  // For all other tests (unit, integration), load the standard .env file if it exists.
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

/* eslint-disable no-undef */

import * as globals from '@jest/globals';

// Re-expose Jest APIs as globals so old tests keep working
Object.assign(globalThis, globals);

// Defaults for integration tests that call `startServer()` directly.
// These are intentionally minimal and only applied when not provided by the environment.
process.env.NODE_ENV ??= 'test';
process.env.DB_PROVIDER ??= 'mem';
process.env.STORAGE_PROVIDER ??= 'mem';
process.env.QUEUE_PROVIDER ??= 'mem';
process.env.MAINSECTOR ??= 'health';
process.env.SUBSECTORSALLOWED ??= 'research,care,index';

process.env.ORG_HOST_LEGAL_NAME ??= 'Gateway Host Services';
process.env.ORG_HOST_JURISDICTION ??= 'ES';
process.env.ORG_HOST_ID_TYPE ??= 'TAX';
process.env.ORG_HOST_ID_VALUE ??= 'A0011223344';
process.env.ORG_HOST_ADMIN_EMAIL ??= 'admin@host.com';
process.env.ORG_HOST_ADMIN_UID ??= 'host-admin-001';
process.env.ORG_HOST_ADMIN_ROLE ??= 'ISCO-08|1111';

jest.setTimeout(65000); // in milliseconds
