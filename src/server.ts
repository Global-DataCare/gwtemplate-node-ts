const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

import { createApp } from './app';
import * as express from 'express';
import admin from 'firebase-admin';


import { ILogger } from './loggers/ILogger';
import { ConsoleLogger } from './loggers/ConsoleLogger';
import { GcsStorageAdapter } from './database/storage/gcs.storage.adapter';
import { IStorageAdapter } from './database/storage/IStorageAdapter';
import { StorageMemAdapter } from './database/storage/mem.storage.adapter';
import { initializeFirebase } from './utils/firebase';

// Initialize Firebase Admin SDK early if configured
if (!isTestEnv && (process.env.DB_PROVIDER === 'firestore' || process.env.STORAGE_PROVIDER === 'gcs')) {
  initializeFirebase();
}

import { Worker } from './worker';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { createApiRouter } from './routes/api';
import { createDiscoveryRouter } from './routes/discovery';
import { DiscoveryService } from './services/DiscoveryService';
import { IKmsService } from './gdc-backend-utils-node/models/IKmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from './gdc-backend-utils-node/adapters/node/crypto';
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
import { IcaManager } from './managers/IcaManager';
import { MessagingManager } from './managers/MessagingManager';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { slugFromDomain } from './utils/slug';
import { IndividualManager } from './managers/IndividualManager';
import { CredentialManager } from './managers/CredentialManager';
import { CompositionManager } from './managers/CompositionManager';
import { BlockchainAdapterMem } from './adapters/BlockchainAdapterMem';
import { CredentialLedgerAdapterMem } from './adapters/CredentialLedgerAdapterMem';
import { createNetworkRouter } from './routes/network';
import { createWebhooksRouter } from './routes/webhooks';
import { IBlockchainAdapter } from './adapters/IBlockchainAdapter';
import { CommunicationManager } from './managers/CommunicationManager';
import { DocumentReferenceManager } from './managers/DocumentReferenceManager';
import { DeviceRegistrationManager } from './managers/DeviceRegistrationManager';
import { IAuthorizationManager } from './managers/auth/IAuthorizationManager';
import { createFhirRouter } from './routes/fhir';
import { createGlobalErrorHandler } from './middlewares/global-error-handler';
import * as path from 'path';
import { generateTenantCollectionNameFromClaims } from './utils/tenant';
import * as swaggerUi from 'swagger-ui-express';
import { LicenseManager } from './managers/LicenseManager';
import { TokenManager } from './managers/TokenManager';
import { DemoTokenVerifier } from './auth/DemoTokenVerifier';
import { createAuthRouter } from './routes/auth';
import { OpenIdAuthManager } from './managers/OpenIdAuthManager';
import { ClearingHouseService } from './services/ClearingHouseService';
import { IdentityTokenManager } from './managers/IdentityTokenManager';
import { ObservationManager } from './managers/ObservationManager';
import { RelatedPersonManager } from './managers/RelatedPersonManager';
import { ConsentManager } from './managers/ConsentManager';
import { createApiDocsSetupOptions } from './managers/ApiDocsManager';
import { SmartAuthorizationManager } from './managers/auth/SmartAuthorizationManager';
import { AppAuthorizationManager } from './managers/AppAuthorizationManager';
import { FamilyManager } from './managers/FamilyManager';
import { FirebaseTokenVerifier } from './auth/FirebaseTokenVerifier';
import * as fs from 'fs';
import { createCredentialLedgerRouter } from './routes/ledger';
import { ICredentialLedgerAdapter } from './adapters/ICredentialLedgerAdapter';
import { CredentialLedgerAdapterMulti } from './adapters/CredentialLedgerAdapterMulti';
import { CredentialLedgerResolver, parseLedgerProviderMap } from './adapters/credential-ledger-resolver';
import { CredentialLedgerAdapterFabric } from './adapters/CredentialLedgerAdapterFabric';
import { createAuthorityRouter } from './routes/authority';
import { loadAuthorityArtifacts } from './utils/authority-artifacts';
import { generatePkiChainFromEnv } from './utils/pki-chain';
import {
  IReplayProtectionStore,
  ReplayProtectionStoreMem,
  ReplayProtectionStoreNoop,
  ReplayProtectionStoreRedis,
} from './adapters/replay-protection-store';
import { getConfig, resetServerConfig } from './config/server-config';
import { bootstrapHost } from './bootstrap/host-bootstrap';

function loadSwaggerSpecFromDisk(): any {
  try {
    const swaggerSpecPath = path.resolve(process.cwd(), 'swagger-spec.json');
    return JSON.parse(fs.readFileSync(swaggerSpecPath, 'utf8'));
  } catch (error) {
    console.warn(`WARN: Could not load swagger-spec.json. Did you run \`npm run build\`? Error: ${error}`);
    return {
      openapi: '3.0.0',
      info: { title: 'Swagger Spec Not Found', version: '0.0.0' },
      paths: {},
    };
  }
}

// Load pre-generated swagger spec once; /swagger-spec.json refreshes from disk on each request.
let swaggerSpec: any = loadSwaggerSpecFromDisk();



interface StartServerOptions {
  testMiddlewares?: express.RequestHandler[];
  authManager?: IAuthorizationManager;
  /** When false, builds the app without binding a TCP port (sandbox-safe for tests). */
  listen?: boolean;
}

function assertSecurityModeGuardrails(config: ReturnType<typeof getConfig>): void {
  const isProduction = String(config.nodeEnv || '').toLowerCase() === 'production';
  if (isProduction && config.securityMode === 'demo') {
    throw new Error("SECURITY_MODE=demo is not allowed when NODE_ENV=production.");
  }
}

function logSecurityModeCapabilities(config: ReturnType<typeof getConfig>): void {
  const acceptsDidcommEncrypted = true;
  const acceptsDidcommPlain = config.securityMode === 'demo' || config.didcommPlainEnabled;
  const acceptsLegacyJson = config.securityMode === 'demo' || config.jsonLegacy;
  const acceptsLegacyFhir = config.securityMode === 'demo' || config.fhirLegacy;
  const allowsInsecureBearer = config.securityMode === 'demo' && config.demoAllowInsecureBearer;

  console.log(
    `[GW-API] Security mode=${config.securityMode} network-mode=${config.networkMode} capabilities: `
      + `didcomm-encrypted=${acceptsDidcommEncrypted}, `
      + `didcomm-plain=${acceptsDidcommPlain}, `
      + `json-legacy=${acceptsLegacyJson}, `
      + `fhir-legacy=${acceptsLegacyFhir}, `
      + `insecure-bearer=${allowsInsecureBearer}`,
  );
}

/**
 * Initializes and starts the Express server.
 */
async function startServer(options?: StartServerOptions) {
  const config = getConfig();
  assertSecurityModeGuardrails(config);
  logSecurityModeCapabilities(config);

  // Initialize a baseline Swagger server URL; /swagger-spec.json will refine it per-request.
  if (swaggerSpec.info.title !== 'Swagger Spec Not Found') {
    swaggerSpec.servers = [{
      url: config.apiBaseUrl,
      description: `Server URL for ${config.nodeEnv} environment`,
    }];
  }

  const app = createApp();
  app.use(express.urlencoded({ extended: true }));

  if (options?.testMiddlewares) {
    options.testMiddlewares.forEach((mw) => app.use(mw));
  }

  // Calculate the correct physical collection name for the host from configuration.
  const hostBootstrapClaims = {
    [ClaimsOrganizationSchemaorg.addressCountry]: config.host.jurisdiction,
    [ClaimsOrganizationSchemaorg.identifierType]: config.host.idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: config.host.idValue,
    [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
  };
  const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims);
  
  // --- DEPENDENCY INJECTION ---
  let vaultRepository: IVaultRepository;
  if (config.dbProvider === 'firestore') {
    const db = admin.firestore();
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

  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());

  // --- Logger Instantiation ---
  // Default to console logger. This can be expanded with a factory for other providers.
  const logger: ILogger = new ConsoleLogger();

  let kmsService: IKmsService;
  // The TenantsCacheManager now requires the physical host collection name to find the host config.
  const tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);


  if (config.nodeEnv === 'demo') {
    // In demo mode, we create a real KMS service first to handle key generation...
    const realKmsService = new KmsService(cryptographyService, tenantManager);
    // ...and then wrap it with the DemoKmsService which bypasses communication crypto.
    kmsService = new DemoKmsService(realKmsService);
    console.log('[GW-API] Using DemoKmsService (with real key generation).');
  } else {
    // In production, we use the real KMS service directly.
    kmsService = new KmsService(cryptographyService, tenantManager);
    console.log('[GW-API] Using KmsService.');
  }
  
  await kmsService.init();
  const clearingHouseService = new ClearingHouseService();

  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger, // Inject logger
    config,
    clearingHouseService,
  );
  const icaManager = new IcaManager(vaultRepository, kmsService);
  const messagingManager = new MessagingManager(vaultRepository, kmsService);
  const employeeManager = new EmployeeManager(vaultRepository, kmsService, tenantManager);
  
  const credentialManager = new CredentialManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config.hostExternalDomain,
  );

  const blockchainAdapter: IBlockchainAdapter = new BlockchainAdapterMem();
  const credentialLedgerMem = new CredentialLedgerAdapterMem();
  const credentialLedgerFabric = new CredentialLedgerAdapterFabric();
  const ledgerProviderMap = parseLedgerProviderMap(process.env.LEDGER_PROVIDER_MAP);
  const ledgerDefaultProvider = process.env.LEDGER_PROVIDER_DEFAULT || 'mem';
  const ledgerProviders: Record<string, ICredentialLedgerAdapter> = {
    mem: credentialLedgerMem,
    fabric: credentialLedgerFabric,
    multi: new CredentialLedgerAdapterMulti([credentialLedgerMem, credentialLedgerFabric]),
  };
  const credentialLedgerAdapter: ICredentialLedgerAdapter = new CredentialLedgerResolver({
    defaultProvider: ledgerDefaultProvider,
    providerMap: ledgerProviderMap,
    providers: ledgerProviders,
  });

  const individualManager = new IndividualManager(
    vaultRepository,
    kmsService,
    tenantManager,
    credentialManager,
    blockchainAdapter,
    config.namespace,
  );

  const familyManager = new FamilyManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
    config,
  );

  const compositionManager = new CompositionManager(vaultRepository);
  const documentReferenceManager = new DocumentReferenceManager(vaultRepository);
  const communicationManager = new CommunicationManager({ tenantsCacheManager: tenantManager });
  const deviceRegistrationManager = new DeviceRegistrationManager(config.apiBaseUrl, vaultRepository, kmsService);
  const licenseManager = new LicenseManager(vaultRepository, kmsService);

  // --- Auth Flow Dependencies ---
  const tokenVerifier =
    isTestEnv || process.env.AUTH_TOKEN_VERIFIER === 'demo'
      ? new DemoTokenVerifier()
      : new FirebaseTokenVerifier();
  const appAuthManager = new AppAuthorizationManager(
    vaultRepository,
    tokenVerifier,
    kmsService,
    cryptographyService
  );
  const tokenManager = new TokenManager(kmsService, tenantManager);
  const identityTokenManager = new IdentityTokenManager(appAuthManager, tokenManager);
  const openIdAuthManager = new OpenIdAuthManager(kmsService, tenantManager, vaultRepository, clearingHouseService);
  const observationManager = new ObservationManager(vaultRepository);
  const relatedPersonManager = new RelatedPersonManager(vaultRepository);
  const consentManager = new ConsentManager({ vaultRepository });

  const discoveryService = new DiscoveryService(tenantManager);

  // Proactively load the host configuration into the cache at startup.
  await tenantManager.loadHost();

  if (!(await tenantManager.getTenant('host'))) {
    console.log('[GW-API] Host tenant not found. Bootstrapping...');
    await bootstrapHost(hostingManager, config);
    // After bootstrapping, explicitly warm up the cache for the host to prevent race conditions on startup.
    console.log('[GW-API] Warming up host cache after bootstrap...');
    await tenantManager.getTenant('host');
  }

  const icaDomain = process.env.ICA_EXTERNAL_DOMAIN;
  const caDomain = process.env.CA_EXTERNAL_DOMAIN;
  if (config.nodeEnv === 'demo' && (icaDomain || caDomain)) {
    const icaSlug = slugFromDomain(icaDomain);
    const caSlug = slugFromDomain(caDomain);
    if (icaSlug) {
      await hostingManager.ensureAuthorityTenant({ alternateName: icaSlug, role: 'ica', externalDomain: icaDomain });
    }
    if (caSlug) {
      await hostingManager.ensureAuthorityTenant({ alternateName: caSlug, role: 'ca', externalDomain: caDomain });
    }
  }

  const managerRegistry: ManagerRegistry = {
    hostingManager,
    tenantManager,
    icaManager,
    messagingManager,
    identityTokenManager,
    observationManager,
    relatedPersonManager,
    familyManager,
    employeeManager,
    individualManager,
    consentManager,
    compositionManager,
    documentReferenceManager,
    communicationManager,
    deviceRegistrationManager,
    licenseManager,
    openIdAuthManager,
  };
  const worker = new Worker(managerRegistry, config.apiBaseUrl, kmsService);
  const asyncResponseStore = new AsyncResponseStoreMem();
  const queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
  const replayProvider = (process.env.REPLAY_PROTECTION_PROVIDER || 'none').toLowerCase();
  const replayProtectionStore: IReplayProtectionStore =
    replayProvider === 'mem'
      ? new ReplayProtectionStoreMem()
      : replayProvider === 'redis'
        ? new ReplayProtectionStoreRedis({
            redisUrl: process.env.REDIS_URL,
            keyPrefix: process.env.REPLAY_REDIS_KEY_PREFIX || 'replay:jti',
          })
        : new ReplayProtectionStoreNoop();
  
  // This is the FHIR-specific AuthorizationManager, not our AppAuthorizationManager.
  const authManager: IAuthorizationManager = options?.authManager || new SmartAuthorizationManager();

  const discoveryRouter = createDiscoveryRouter(tenantManager, discoveryService, kmsService, logger);

  const authorityArtifacts: Record<string, ReturnType<typeof loadAuthorityArtifacts>> = {};
  const roles = new Set(config.localServiceRoles || []);
  if (roles.has('CA') || roles.has('ICA')) {
    const artifactsRoot = path.join(process.cwd(), 'artifacts');
    const rootDir = process.env.LOCAL_CA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-root-ca');
    const icaDir = process.env.LOCAL_ICA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-ica');
    const needsRoot = roles.has('CA') && !fs.existsSync(rootDir);
    const needsIca = roles.has('ICA') && !fs.existsSync(icaDir);

    if (needsRoot || needsIca) {
      const isDemo = config.nodeEnv === 'demo' || process.env.DEV_SEED === 'true';
      if (isDemo) {
        console.log('[GW-API] Missing authority artifacts. Generating demo PKI chain from env...');
        await generatePkiChainFromEnv({ cleanOutput: true });
      } else {
        throw new Error(`[GW-API] Missing authority artifacts. Expected ${rootDir} and ${icaDir}`);
      }
    }

    if (roles.has('CA')) {
      authorityArtifacts.CA = loadAuthorityArtifacts('CA', rootDir);
    }
    if (roles.has('ICA')) {
      const rootDerPath = path.join(rootDir, 'root-cert.der');
      authorityArtifacts.ICA = loadAuthorityArtifacts('ICA', icaDir, rootDerPath);
    }
  }
  const authorityRouter = Object.keys(authorityArtifacts).length
    ? createAuthorityRouter(authorityArtifacts, asyncResponseStore)
    : undefined;
  const apiRouter = createApiRouter(
    queueAdapter,
    tenantManager,
    kmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    config.apiBaseUrl,
    appAuthManager,
    replayProtectionStore,
  );
  const networkRouter = createNetworkRouter(queueAdapter, kmsService);
  const fhirRouter = createFhirRouter(queueAdapter, authManager);
  const ledgerRouter = createCredentialLedgerRouter(credentialLedgerAdapter, asyncResponseStore, tenantManager, config.networkMode);
  const webhooksRouter = createWebhooksRouter(queueAdapter);
  const authRouter = createAuthRouter(appAuthManager, tokenManager);
  app.use('/', discoveryRouter);
  if (authorityRouter) {
    app.use('/', authorityRouter);
  }
  app.use('/', ledgerRouter);
  app.use('/', apiRouter);
  app.use('/', networkRouter);
  app.use('/', fhirRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/auth', authRouter);

  // --- Global Error Handling Middleware (MUST be the LAST middleware) ---
  app.use(createGlobalErrorHandler(logger));

  app.get('/swagger-spec.json', (req: express.Request, res: express.Response) => {
    const runtimeSwaggerSpec = loadSwaggerSpecFromDisk();
    res.setHeader('Cache-Control', 'no-store');
    if (runtimeSwaggerSpec.info.title === 'Swagger Spec Not Found') {
      res.json(runtimeSwaggerSpec);
      return;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
      ?.split(',')[0]
      ?.trim() || req.protocol;
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host');
    const baseUrl = host ? `${protocol}://${host}` : config.apiBaseUrl;

    res.json({
      ...runtimeSwaggerSpec,
      servers: [{
        url: baseUrl,
        description: `Server URL for ${config.nodeEnv} environment`,
      }],
    });
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(undefined, createApiDocsSetupOptions('/swagger-spec.json') as any));

  const server =
    options?.listen === false
      ? undefined
      : app.listen(config.port, config.apiHostname, () => {
          console.log(`[GW-API] Listening on ${config.apiHostname}:${config.port}`);
        });

  return { app, server, queueAdapter, tenantManager, vaultRepository, cryptographyService, blockchainAdapter, credentialLedgerAdapter, kmsService };
}

export { startServer, resetServerConfig };
