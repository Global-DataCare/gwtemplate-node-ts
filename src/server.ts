// src/server.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import dotenv from 'dotenv';
import { config } from './config';
import { createApiRouter } from './routes/api';
import { VaultRepository } from './database/repositories/vault/vault.repository';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { QueueAdapter } from './adapters/queue';
import { QueueAdapterMem } from './adapters/queue-mem';
import { DevKmsService } from './security/DevKmsService';
import { Worker } from './worker';
import { ManagerRegistry } from './managers/registry';
import { OrganizationManager } from './managers/OrganizationManager';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';

dotenv.config();

/**
 * Main function to bootstrap and start the application.
 * This function is a "Composition Root" that reads configuration and wires
 * up the application's dependencies.
 */
async function startServer() {
  console.log('[GW-API] Initializing...');
  const app = express();

  // --- 1. MIDDLEWARE SETUP ---
  app.use(express.urlencoded({ extended: false })); // for FAPI form params
  app.use(express.text({ type: 'text/plain' }));    // for simple DIDComm transport
  app.use(express.json());                           // for polling endpoint

  // --- 2. DEPENDENCY INJECTION based on Configuration ---

  let vaultRepository: VaultRepository;
  switch (config.dbProvider) {
    case 'mem':
      console.log('[GW-API] Using in-memory Vault Repository.');
      vaultRepository = new VaultMemRepository();
      break;
    // case 'firestore':
    //   vaultRepository = new VaultFirestoreRepository(config.firebase);
    //   break;
    default:
      throw new Error(`Unsupported DB_PROVIDER: ${config.dbProvider}`);
  }
  await vaultRepository.createNewVault({ id: 'host', name: 'Host Vault' });

  const tenantManager = new TenantsCacheManager(vaultRepository);
  const kmsService = new DevKmsService(tenantManager);

  const managerRegistry: ManagerRegistry = {
    organizationManager: new OrganizationManager(vaultRepository, kmsService),
    tenantManager: tenantManager,
  };

  const worker = new Worker(managerRegistry);

  let queueAdapter: QueueAdapter;
  const asyncResponseStore = new AsyncResponseStoreMem(); // Use the new store
  switch (config.queueProvider) {
    case 'mem':
      console.log('[GW-API] Using in-memory Queue Adapter.');
      queueAdapter = new QueueAdapterMem(asyncResponseStore, worker); // Pass the store to the queue
      break;
    // case 'redis':
    //   queueAdapter = new QueueAdapterRedis(config.redis, worker);
    //   break;
    default:
      throw new Error(`Unsupported QUEUE_PROVIDER: ${config.queueProvider}`);
  }

  // --- 3. API ROUTERS ---
  const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore);
  app.use('/', apiRouter);

  // --- 4. START SERVER ---
  app.listen(config.port, () => {
    console.log(`[GW-API] Development Server running on ${config.apiBaseUrl}`);
    console.log('[GW-API] --- System Initialized Successfully ---');
  });

  return app;
}

startServer().catch(error => {
  console.error('[GW-API] Failed to start server:', error);
  process.exit(1);
});

// Export for tests
export { startServer };