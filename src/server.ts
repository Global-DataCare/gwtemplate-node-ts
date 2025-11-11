// src/server.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as admin from 'firebase-admin';
import * as express from 'express';
import * as dotenv from 'dotenv';
// Load environment variables from .env file at the very top of the application
dotenv.config();

import { GcsStorageAdapter } from './database/storage/gcs.storage.adapter';
import { IStorageAdapter } from './database/storage/IStorageAdapter';
import { StorageMemAdapter } from './database/storage/mem.storage.adapter';
import { initializeFirebase } from './utils/firebase';

// Initialize Firebase Admin SDK early if configured
if (process.env.DB_PROVIDER === 'firestore' || process.env.STORAGE_PROVIDER === 'gcs') {
  initializeFirebase();
}

import { Worker } from './worker';
import { IServerConfig } from './config';
import { Sector } from './models/urlPath';
import { createApiRouter } from './routes/api';
import { createDiscoveryRouter } from './routes/discovery';
import { DiscoveryService } from './services/DiscoveryService';
import { IKmsService } from './crypto/interfaces/IKmsService';
import { CryptographyService } from './crypto/CryptographyService';
import { KmsService } from './services/KmsService';
import { DemoKmsService } from './services/DemoKmsService';
import { QueueAdapterMem } from './adapters/queue-mem';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';
import { IVaultRepository } from './database/repositories/vault/vault.repository';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { FirestoreVaultRepository } from './database/repositories/firestore/firestore.vault.repository';
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
import { IAuthorizationManager } from './managers/auth/IAuthorizationManager';
import { createFhirRouter } from './routes/fhir';
import { AuthorizationManager } from './managers/AuthorizationManager';
import * as swaggerUi from 'swagger-ui-express';
import { generateTenantCollectionNameFromClaims } from './utils/tenant';
const swaggerSpec = require('../swagger.config.js');

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
  const requestedSectors = csv.split(',').map((s) => s.trim());
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
      storageProvider: process.env.STORAGE_PROVIDER || 'mem',
      queueProvider: process.env.QUEUE_PROVIDER || 'mem',
      gcsBucketName: process.env.GCS_BUCKET_NAME,
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
    [ClaimsOrganizationSchemaorg.identifierType]: bootConfig.host.idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: bootConfig.host.idValue,
    [ClaimsOrganizationSchemaorg.addressCountry]: bootConfig.host.jurisdiction,
    [ClaimsOrganizationSchemaorg.legalName]: bootConfig.host.legalName,
    [ClaimsOrganizationSchemaorg.alternateName]: 'host',
    [ClaimsPersonSchemaorg.email]: bootConfig.host.adminEmail,
    [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${bootConfig.host.adminUid}`,
    [ClaimsPersonSchemaorg.hasOccupation]: bootConfig.host.adminRole,
    [ClaimsServiceSchemaorg.category]: 'system', 
    [ClaimsServiceSchemaorg.identifier]: `urn:uuid:${bootConfig.host.idValue}-service`,
  };

  try {
    await hostingManager.bootstrapHost(hostClaims);
  } catch (error) {
    console.error('[GW-API] FATAL: Host tenant bootstrapping failed.', error);
    throw error;
  }
}

interface StartServerOptions {
  testMiddlewares?: express.RequestHandler[];
  authManager?: IAuthorizationManager;
}

/**
 * Initializes and starts the Express server.
 */
async function startServer(options?: StartServerOptions) {
  const config = getConfig();

  const app = express.default();
  app.use(express.default.urlencoded({ extended: true }));
  app.use(express.default.json({ type: ['application/json', 'application/fhir+json'] }));

  if (options?.testMiddlewares) {
    options.testMiddlewares.forEach((mw) => app.use(mw));
  }

  // --- DEPENDENCY INJECTION ---
  let vaultRepository: IVaultRepository;
  if (config.dbProvider === 'firestore') {
    const db = admin.firestore();
    // Calculate the correct physical collection name for the host from configuration.
    const hostBootstrapClaims = {
      [ClaimsOrganizationSchemaorg.addressCountry]: config.host.jurisdiction,
      [ClaimsOrganizationSchemaorg.identifierType]: config.host.idType,
      [ClaimsOrganizationSchemaorg.identifierValue]: config.host.idValue,
      [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
    };
    const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims);
    vaultRepository = new FirestoreVaultRepository(db, hostCollectionName);
    console.log('[GW-API] Using Firestore Vault Repository.');
  } else {
    vaultRepository = new VaultMemRepository();
    (vaultRepository as VaultMemRepository).clear(); // Explicitly clear on start
    console.log('[GW-API] Using In-Memory Vault Repository (cleared).');
  }

  let storageAdapter: IStorageAdapter;
  if (config.storageProvider === 'gcs') {
    if (!config.gcsBucketName) {
      throw new Error("STORAGE_PROVIDER is 'gcs', but GCS_BUCKET_NAME is not configured.");
    }
    storageAdapter = new GcsStorageAdapter(config.gcsBucketName);
    console.log(`[GW-API] Using GCS Storage Adapter with bucket: ${config.gcsBucketName}`);
  } else {
    storageAdapter = new StorageMemAdapter();
    console.log('[GW-API] Using In-Memory Storage Adapter.');
  }

  const cryptographyService = new CryptographyService();

  let kmsService: IKmsService;
  const tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService);

  kmsService =
    config.nodeEnv === 'demo' ? new DemoKmsService() : new KmsService(cryptographyService, tenantManager);
  await kmsService.init();

  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    config,
  );
  const employeeManager = new EmployeeManager(vaultRepository, kmsService, tenantManager);
  
  const credentialManager = new CredentialManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config.hostExternalDomain,
  );

  const blockchainAdapter: IBlockchainAdapter = new BlockchainAdapterMem();

  const customerManager = new CustomerManager(
    vaultRepository,
    kmsService,
    tenantManager,
    credentialManager,
    blockchainAdapter,
    config.namespace,
  );

  const compositionManager = new CompositionManager();
  const communicationManager = new CommunicationManager({ tenantsCacheManager: tenantManager });

  const discoveryService = new DiscoveryService(tenantManager);

  await tenantManager.loadTenants();

  if (!(await tenantManager.getTenant('host'))) {
    console.log('[GW-API] Host tenant not found. Bootstrapping...');
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
  const authManager = options?.authManager || new AuthorizationManager();

  const discoveryRouter = createDiscoveryRouter(tenantManager, discoveryService);
  const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, vaultRepository, cryptographyService);
  const networkRouter = createNetworkRouter(queueAdapter, kmsService);
  const fhirRouter = createFhirRouter(queueAdapter, authManager);
  app.use('/', discoveryRouter);
  app.use('/', apiRouter);
  app.use('/', networkRouter);
  app.use('/', fhirRouter);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  const server = app.listen(config.port, () => {
    // console.log(`[GW-API ${config.nodeEnv} Server running on ${config.apiBaseUrl}`);
  });

  return { app, server, queueAdapter, tenantManager, vaultRepository, cryptographyService, blockchainAdapter, kmsService };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[GW-API] Failed to start server:', error);
    process.exit(1);
  });
}

export { startServer };
