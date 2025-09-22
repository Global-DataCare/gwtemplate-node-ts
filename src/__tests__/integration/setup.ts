// src/__tests__/integration/setup.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IServerConfig } from '../../config';

/**
 * Sets up the environment variables for integration tests and forces a reload of the config module.
 * It's critical that this is called at the very beginning of a test file, before any application
 * code that might import `config` is loaded.
 */
export const setupIntegrationTest = (): IServerConfig => {
  // Set all necessary environment variables to predictable test values.
  process.env.NODE_ENV = 'development';
  process.env.DB_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.API_HOSTNAME = 'localhost';
  process.env.PORT = '3001'; // Use a different port to avoid conflicts
  process.env.KEK_SECRET = 'test-super-secret-key-for-integration-tests';

  // --- Crucial for routing validation ---
  process.env.SECTORS_ALLOWED = 'test,health-care';
  
  // --- Host configuration for bootstrapping ---
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Test';
  process.env.ORG_HOST_JURISDICTION = 'XX'; // Using 'XX' for tests
  process.env.ORG_HOST_ID_TYPE = 'lei';
  process.env.ORG_HOST_ID_VALUE = 'TESTHOSTLEI';
  process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.test';
  process.env.ORG_HOST_ADMIN_UID = 'host-admin-uuid';

  // This is the crucial part. We tell Jest to discard its cached version of all modules.
  jest.resetModules();

  // Now, when we require the config module, it will be re-evaluated, and it will
  // read the `process.env` variables we just set above.
  const { config } = require('../../config');
  
  return config;
};
