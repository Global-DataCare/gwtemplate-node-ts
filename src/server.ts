// src/server.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import dotenv from 'dotenv';
import { config, IServerConfig } from './config';
import { createApiRouter } from './routes/api';
import { VaultRepository } from './database/repositories/vault/vault.repository';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { QueueAdapter } from './adapters/queue';
import { QueueAdapterMem } from './adapters/queue-mem';
import { DevKmsService } from './services/DevKmsService';
import { Worker } from './worker';
import { ManagerRegistry } from './managers/registry';
import { OrganizationManager } from './managers/OrganizationManager';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';
import { JobRequest } from './models/request';
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg } from './models/schemaorg';
import { CryptographyService } from './crypto/CryptographyService';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { KmsService } from './services/KmsService';

dotenv.config();

/**
 * Bootstraps the 'host' tenant by creating and persisting its initial configuration.
 * This function reads configuration from environment variables, simulates a registration
 * job, and uses the OrganizationManager to process it, ensuring the host is a
 * fully-fledged tenant from the moment the server starts.
 *
 * @param orgManager The OrganizationManager instance.
 * @param bootConfig The global server configuration from the environment.
 */
async function bootstrapHost(orgManager: OrganizationManager, bootConfig: IServerConfig) {
  console.log('[GW-API] Bootstrapping host tenant...');
  
  // 1. Construct the claims record from the server configuration.
  const hostClaims = {
    [ClaimsOrgSchemaorg.legalName]: bootConfig.host.legalName,
    [ClaimsOrgSchemaorg.addressCountry]: bootConfig.host.jurisdiction,
    [ClaimsOrgSchemaorg.taxID]: bootConfig.host.idValue,
    [ClaimsOrgSchemaorg.alternateName]: 'host',
    [ClaimsPersonSchemaorg.email]: bootConfig.host.adminEmail,
    [ClaimsPersonSchemaorg.identifier]: bootConfig.host.adminUid,
  };

  // 2. Build a complete JobRequest that mimics a real registration request.
  // This structure must match what the OrganizationManager expects.
  const bootstrapJob: JobRequest = {
    tenantId: 'host',
    jurisdiction: bootConfig.host.jurisdiction,
    resourceType: 'Organization',
    section: 'org.schema',
    action: '_batch',
    input: {
      aud: 'system:bootstrap',
      iss: 'system:bootstrap',
      thid: `bootstrap-${Date.now()}`,
      type: 'Organization-registration-form-v1.0',
      body: {
        data: [{ meta: { claims: hostClaims } }]
      }
    }
  };

  try {
    // 3. Process the job directly, passing the correct environment from the config.
    await orgManager.process(bootstrapJob, bootConfig.nodeEnv);
    console.log('[GW-API] Host tenant bootstrapped successfully.');
  } catch (error) {
    console.error('[GW-API] FATAL: Host tenant bootstrapping failed.', error);
  }
}

async function startServer() {
  console.log('[GW-API] Initializing...');
  const app = express();

  // --- 1. MIDDLEWARE SETUP ---
  app.use(express.urlencoded({ extended: false })); // for FAPI form params
  app.use(express.text({ type: 'text/plain' }));    // for JWE/DIDComm transport in the HTTP body (alternative to FAPI / JAR using request form ulr parameters)
  app.use(express.json());                           // for legacy json
  app.use(express.json({ type: "application/fhir+json" })); // for legacy FHIR

  // --- 2. DEPENDENCY INJECTION & STARTUP SEQUENCE ---
  // The order of initialization is critical.

  // 2a. Initialize the database layer.
  let vaultRepository: VaultRepository;
  switch (config.dbProvider) {
    case 'mem':
      console.log('[GW-API] Using in-memory Vault Repository.');
      vaultRepository = new VaultMemRepository();
      break;
    default:
      throw new Error(`Unsupported DB_PROVIDER: ${config.dbProvider}`);
  }
  // At this point, the vault for the 'host' does not exist yet.

  // 2b. Initialize Cryptography & KMS.
  // This is the core of the system's security. We instantiate the real, low-level
  // cryptographic engine first. Then, we select the Key Management Service (KMS)
  // based on the environment.
  // - In 'production' or 'development', we use the real KmsService which performs
  //   actual cryptographic operations.
  // - In 'demo' or other test environments, we use DevKmsService, which simulates
  //   cryptography for easier testing and demonstration.
  console.log(`[GW-API] Environment set to: ${config.nodeEnv}`);
  const cryptographyService = new CryptographyService();
  let kmsService: IKmsService;

  if (config.nodeEnv === 'development' || config.nodeEnv === 'production') {
    console.log('[GW-API] Using real KmsService with live cryptography.');
    kmsService = new KmsService(cryptographyService);
  } else {
    console.log('[GW-API] Using DevKmsService with simulated cryptography.');
    kmsService = new DevKmsService(); // DevKmsService likely needs the tenantManager too
  }
  
  // 2c. Initialize core services and managers.
  // The TenantsCacheManager is created, but the host config is not yet loaded.
  const tenantManager = new TenantsCacheManager(vaultRepository);
  const orgManager = new OrganizationManager(vaultRepository, kmsService);

  // 2d. Bootstrap the 'host' tenant. This is a critical step.
  // We use the OrganizationManager to process a self-registration job for the host.
  // This creates the host's vault and persists its configuration, making it a real tenant.
  await bootstrapHost(orgManager, config);

  // 2d. The remaining services can now be initialized.
  const managerRegistry: ManagerRegistry = {
    organizationManager: orgManager,
    tenantManager: tenantManager,
  };
  const worker = new Worker(managerRegistry);
  const asyncResponseStore = new AsyncResponseStoreMem();
  let queueAdapter: QueueAdapter;
  switch (config.queueProvider) {
    case 'mem':
      console.log('[GW-API] Using in-memory Queue Adapter.');
      queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
      break;
    default:
      throw new Error(`Unsupported QUEUE_PROVIDER: ${config.queueProvider}`);
  }

  // --- 3. API ROUTERS ---
  // The API router is created last, once all dependencies are ready.
  // It can now safely handle requests to `/host/...` because the host has been bootstrapped.
  const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore);
  app.use('/', apiRouter);

  // --- 4. START LISTENING ---
  const server = app.listen(config.port, () => {
    console.log(`[GW-API] Development Server running on ${config.apiBaseUrl}`);
    console.log('[GW-API] --- System Initialized Successfully ---');
  });

  return { app, server };
}

// Only start the server if this file is run directly
if (require.main === module) {
  startServer().catch(error => {
    console.error('[GW-API] Failed to start server:', error);
    process.exit(1);
  });
}

// Export for tests
export { startServer };