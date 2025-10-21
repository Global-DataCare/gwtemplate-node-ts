// src/server.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import * as dotenv from 'dotenv';
import { Worker } from './worker';
import { IServerConfig } from './config';
import { Sector } from './models/path';
import { createApiRouter } from './routes/api';
import { createDiscoveryRouter } from './routes/discovery';
import { DiscoveryService } from './services/DiscoveryService';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { CryptographyService } from './crypto/CryptographyService';
import { KmsService } from './services/KmsService';
import { DemoKmsService } from './services/DemoKmsService';
import { QueueAdapterMem } from './adapters/queue-mem';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { ManagerRegistry } from './managers/registry';
import { HostingManager } from './managers/HostingManager';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { EmployeeManager } from './managers/EmployeeManager';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from './models/schemaorg';
import { CustomerManager } from './managers/CustomerManager';
import { CredentialManager } from './managers/CredentialManager';
import { CompositionManager } from './managers/CompositionManager';
import { BlockchainAdapterMem } from './adapters/BlockchainAdapterMem';
import { createNetworkRouter } from './routes/network';
import { IBlockchainAdapter } from './adapters/IBlockchainAdapter';
import { CommunicationManager } from './managers/CommunicationManager';

// ===================================================================================
// CONFIGURATION LOGIC - INTERNAL TO SERVER.TS
// ===================================================================================

let configInstance: IServerConfig;

function buildApiBaseUrl(port: number): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const protocol = nodeEnv === 'production' ? 'https' : 'http';
  const hostname = process.env.API_HOSTNAME || 'localhost';

  if ((protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)) {
    return `${protocol}://${hostname}`;
  }
  return `${protocol}://${hostname}:${port}`;
}

function parseAndValidateSectors(csv: string | undefined): Sector[] {
  if (!csv) return [];
  const allSectors = Object.values(Sector) as string[];
  const requestedSectors = csv.split(',').map(s => s.trim());
  for (const sector of requestedSectors) {
    if (sector === Sector.SYSTEM) {
      throw new Error(`Config Error: The '${Sector.SYSTEM}' sector is reserved and cannot be set in SECTORS_ALLOWED.`);
    }
    if (!allSectors.includes(sector)) {
      throw new Error(`Config Error: Invalid sector '${sector}'. Allowed: ${allSectors.join(', ')}`);
    }
  }
  return requestedSectors as Sector[];
}

/**
 * Gets the application configuration. Reads from process.env on the first call
 * and caches the result. This function is now internal to server.ts.
 */
function getConfig(): IServerConfig {
  if (!configInstance) {
    const port = parseInt(process.env.PORT || '3000', 10);
    configInstance = {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: port,
      apiHostname: process.env.API_HOSTNAME || 'localhost',
      hostExternalDomain: process.env.HOST_EXTERNAL_DOMAIN || process.env.API_HOSTNAME || 'localhost',
      apiBaseUrl: buildApiBaseUrl(port),
      namespace: process.env.URN_NAMESPACE || 'antifraud',
      sectorsAllowed: parseAndValidateSectors(process.env.SECTORS_ALLOWED),
      dbProvider: process.env.DB_PROVIDER || 'mem',
      queueProvider: process.env.QUEUE_PROVIDER || 'mem',
      kekSecret: process.env.KEK_SECRET,
      host: {
        legalName: process.env.ORG_HOST_LEGAL_NAME,
        jurisdiction: process.env.ORG_HOST_JURISDICTION,
        idType: process.env.ORG_HOST_ID_TYPE,
        idValue: process.env.ORG_HOST_ID_VALUE,
        adminEmail: process.env.ORG_HOST_ADMIN_EMAIL,
        adminUid: process.env.ORG_HOST_ADMIN_UID,
        adminRole: process.env.ORG_HOST_ADMIN_ROLE,
      },
      mongo: {
        uri: process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME || 'default',
      },
      firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      googleClientId: process.env.GOOGLE_CLIENT_ID,
    };
  }
  return configInstance;
}

// ===================================================================================
// SERVER INITIALIZATION
// ===================================================================================

/**
 * Bootstraps the host tenant using a direct method, reading all values from config.
 */
async function bootstrapHost(hostingManager: HostingManager, bootConfig: IServerConfig) {
  // console.log('[GW-API] Bootstrapping host tenant...');
  const hostClaims = {
    // [ClaimsOrganizationSchemaorg.identifier] is generated when persisting the host (tenant zero)
    [ClaimsOrganizationSchemaorg.identifierType]: bootConfig.host.idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: bootConfig.host.idValue,
    [ClaimsOrganizationSchemaorg.addressCountry]: bootConfig.host.jurisdiction,
    [ClaimsOrganizationSchemaorg.legalName]: bootConfig.host.legalName,
    [ClaimsOrganizationSchemaorg.alternateName]: 'host',
    [ClaimsPersonSchemaorg.email]: bootConfig.host.adminEmail,
    [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${bootConfig.host.adminUid}`,
    [ClaimsPersonSchemaorg.hasOccupation]: bootConfig.host.adminRole,
    // TODO: Review accepted software manufacturer terms
    [ClaimsServiceSchemaorg.category]: 'system', 
    [ClaimsServiceSchemaorg.identifier]: `urn:uuid:${bootConfig.host.idValue}-service`,
  };

  try {
    await hostingManager.bootstrapHost(hostClaims);
    // console.log('[GW-API] Host tenant bootstrapped successfully.');
  } catch (error) {
    console.error('[GW-API] FATAL: Host tenant bootstrapping failed.', error);
    throw error;
  }
}

/**
 * Initializes and starts the Express server.
 */
async function startServer() {
  dotenv.config();
  const config = getConfig();

  // console.log('[GW-API] Initializing...');
  const app = express.default();
  app.use(express.default.urlencoded({ extended: true }));
  app.use(express.default.json());

  const vaultRepository = new VaultMemRepository();

  const cryptographyService = new CryptographyService();

  // KmsService and TenantsCacheManager have a circular dependency.
  // - KmsService needs TenantsCacheManager to resolve DIDs for key lookup.
  // - TenantsCacheManager needs KmsService to decrypt tenant data from the vault.
  // To break the cycle, we provide TenantsCacheManager with a function that resolves
  // to the KmsService instance, which will be fully initialized later.
  let kmsService: IKmsService;
  const tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService);

  kmsService =
    config.nodeEnv === 'demo'
      ? new DemoKmsService()
      : new KmsService(cryptographyService, tenantManager);
  await kmsService.init();

  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config,
  );
  const employeeManager = new EmployeeManager(vaultRepository, kmsService, tenantManager);
  
  const credentialManager = new CredentialManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config.hostExternalDomain,
  );

  // For now, we'll use the in-memory adapter. This can be swapped with a real
  // Fabric adapter based on config settings in the future.
  const blockchainAdapter: IBlockchainAdapter = new BlockchainAdapterMem();

  const customerManager = new CustomerManager(
    vaultRepository,
    kmsService,
    tenantManager,
    credentialManager,
    blockchainAdapter,
    config.namespace // Pass the configured network name (e.g., 'antifraud')
  );

  const compositionManager = new CompositionManager();
  const communicationManager = new CommunicationManager({ tenantsCacheManager: tenantManager });

  const discoveryService = new DiscoveryService(tenantManager);

  if (!(await vaultRepository.vaultExists('host'))) {
    await bootstrapHost(hostingManager, config);
  }

  const managerRegistry: ManagerRegistry = { 
    hostingManager, 
    tenantManager,
    employeeManager,
    customerManager,
    compositionManager,
    communicationManager,
  };
  const worker = new Worker(managerRegistry, config.apiBaseUrl, kmsService);
  const asyncResponseStore = new AsyncResponseStoreMem();
  const queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);

  const discoveryRouter = createDiscoveryRouter(tenantManager, discoveryService);
  const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, vaultRepository, cryptographyService);
  const networkRouter = createNetworkRouter(queueAdapter, kmsService);
  app.use('/', discoveryRouter);
  app.use('/', apiRouter);
  app.use('/', networkRouter);

  const server = app.listen(config.port, () => {
    // console.log(`[GW-API ${config.nodeEnv} Server running on ${config.apiBaseUrl}`);
    // console.log('[GW-API] --- System Initialized Successfully ---');
  });

  return { app, server, queueAdapter, tenantManager, kmsService, blockchainAdapter, vaultRepository, cryptographyService };
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('[GW-API] Failed to start server:', error);
    process.exit(1);
  });
}

export { startServer };
