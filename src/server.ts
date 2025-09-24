// src/server.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import dotenv from 'dotenv';
import { Worker } from './worker';
import { config, IServerConfig } from './config';
import { createApiRouter } from './routes/api';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { CryptographyService } from './crypto/CryptographyService';
import { KmsService } from './services/KmsService';
import { DemoKmsService } from './services/DemoKmsService';
import { QueueAdapter } from './adapters/queue';
import { QueueAdapterMem } from './adapters/queue-mem';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';
import { VaultRepository } from './database/repositories/vault/vault.repository';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { ManagerRegistry } from './managers/registry';
import { OrganizationManager } from './managers/OrganizationManager';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { JobRequest } from './models/request';
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from './models/schemaorg';

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
  // Each claim key MUST be prefixed with its schema.org type for extraction.
  const hostClaims = {
    // Organization Claims
    [ClaimsOrgSchemaorg.legalName]: bootConfig.host.legalName,
    [ClaimsOrgSchemaorg.addressCountry]: bootConfig.host.jurisdiction,
    [ClaimsOrgSchemaorg.taxID]: bootConfig.host.idValue,
    [ClaimsOrgSchemaorg.alternateName]: 'host',
    [ClaimsOrgSchemaorg.identifier]: `urn:uuid:${bootConfig.host.idValue}`, // Required for resource ID

    // Legal Representative
    [ClaimsPersonSchemaorg.email]: bootConfig.host.adminEmail,
    [ClaimsPersonSchemaorg.identifier]: bootConfig.host.adminUid,

    // Software Manufacturer
    [ClaimsServiceSchemaorg.category]:  bootConfig.sectorsAllowed,
    [ClaimsServiceSchemaorg.identifier]: `did:web:antifraud.services`, // Sofware manufacturer to verify the software's signature
    [ClaimsServiceSchemaorg.termsOfService]: 'did:web:antifraud.services:gateway:terms',
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
    // 3. Process the job directly. For bootstrap, any error is fatal.
    await orgManager.process(bootstrapJob, bootConfig.nodeEnv, true);
    console.log('[GW-API] Host tenant bootstrapped successfully.');
  } catch (error) {
    console.error('[GW-API] FATAL: Host tenant bootstrapping failed.', error);
    // Re-throw to prevent the server from starting in a corrupt state.
    throw error;
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
  // - In 'demo' or other test environments, we use DemoKmsService, which simulates
  //   cryptography for easier testing and demonstration.
  console.log(`[GW-API] Environment set to: ${config.nodeEnv}`);
  const cryptographyService = new CryptographyService();
  let kmsService: IKmsService;

  if (config.nodeEnv === 'demo') {
    console.log('[GW-API] Using DemoKmsService with simulated cryptography.');
    kmsService = new DemoKmsService();
  } else {
    // For 'production', 'development', and 'test', we use the real KmsService.
    console.log('[GW-API] Using real KmsService with live cryptography.');
    kmsService = new KmsService(cryptographyService);
  }
  
  // CRITICAL STEP: Initialize the KMS to provision host keys before any other service uses it.
  await kmsService.init();

  // 2c. Initialize core services and managers.
  // The TenantsCacheManager requires the KmsService to decrypt tenant configurations.
  const tenantManager = new TenantsCacheManager(vaultRepository, kmsService);
  const orgManager = new OrganizationManager(vaultRepository, kmsService);

  // 2d. Bootstrap the 'host' tenant. This is a critical step.
  // We use the OrganizationManager to process a self-registration job for the host.
  
  // This creates the host's vault and persists its configuration, making it a real tenant.
  await bootstrapHost(orgManager, config);

  // CRITICAL STEP: The tenant cache was created *before* the host was bootstrapped.
  // We must now explicitly load the tenants to ensure the cache is populated with the
  // newly created host configuration (tenant zero).
  await tenantManager.loadTenants();

  // 2e. The remaining services can now be initialized.
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

  // --- 4. START LISTENING (ONLY AFTER BOOTSTRAP IS COMPLETE) ---
  const server = app.listen(config.port, () => {
    const serverType = config.nodeEnv.charAt(0).toUpperCase() + config.nodeEnv.slice(1);
    console.log(`[GW-API] ${serverType} Server running on ${config.apiBaseUrl}`);
    console.log('[GW-API] --- System Initialized Successfully ---');
  });

  return { app, server, queueAdapter };
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