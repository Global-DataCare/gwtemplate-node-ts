// src/__tests__/integration/setup.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IServerConfig } from "../../config";
import { Sector } from "../../models/sector";

/**
 * Sets up a consistent test environment for integration tests.
 * This function modifies `process.env` to ensure that tests run with a predictable
 * configuration, regardless of the actual environment variables set on the machine.
 *
 * It returns a partial `IServerConfig` object containing the key values used,
 * allowing tests to make assertions against the correct configuration.
 *
 * @returns {Partial<IServerConfig>} A configuration object with the test values.
 */
export function setupIntegrationTest(): Partial<IServerConfig> {

  // --- CRITICAL: Set environment variables BEFORE any app code is imported ---
  process.env.NODE_ENV = 'development';
  process.env.PORT = '3001'; // Use a different port to avoid conflicts with a running dev server
  process.env.DB_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';

  // We align it with the data used in our test tenant ('acme' is in the 'health-care' sector).
  process.env.SECTORS_ALLOWED = Sector.HEALTH_CARE;

  process.env.ORG_HOST_JURISDICTION = 'ES';
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Test Host';

  // Return a config object that tests can use to build URLs, etc.
  const testConfig: Partial<IServerConfig> = {
    port: parseInt(process.env.PORT, 10),
    host: {
      jurisdiction: process.env.ORG_HOST_JURISDICTION,
    },
    sectorsAllowed: [Sector.HEALTH_CARE],
  };

  return testConfig;
}
