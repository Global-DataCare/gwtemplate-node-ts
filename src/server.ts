const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

import app from './app';
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
import { IServerConfig } from './config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { createApiRouter } from './routes/api';
import { createDiscoveryRouter } from './routes/discovery';
import { createAuthorityRouter } from './routes/authority';
import { DiscoveryService } from './services/DiscoveryService';
import { IKmsService } from './gdc-backend-utils-node/models/IKmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from './gdc-backend-utils-node/adapters/node/crypto';
import { KmsService } from './services/KmsService';
import { DemoKmsService } from './services/DemoKmsService';
import { QueueAdapterMem } from './adapters/queue-mem';
import { AsyncResponseStoreMem } from './adapters/async-response-store.mem';
import { loadAuthorityArtifacts } from './utils/authority-artifacts';
import { IVaultRepository } from './database/repositories/vault/vault.repository';
import { VaultMemRepository } from './database/repositories/vault/vault.mem.repository';
import { FirestoreVaultRepository } from './database/repositories/firestore/firestore.vault.repository';
import { ManagerRegistry } from './managers/registry';
import { HostingManager } from './managers/HostingManager';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { EmployeeManager } from './managers/EmployeeManager';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { IndividualManager } from './managers/IndividualManager';
import { CredentialManager } from './managers/CredentialManager';
import { CompositionManager } from './managers/CompositionManager';
import { BlockchainAdapterMem } from './adapters/BlockchainAdapterMem';
import { createNetworkRouter } from './routes/network';
import { createWebhooksRouter } from './routes/webhooks';
import { IBlockchainAdapter } from './adapters/IBlockchainAdapter';
import { CommunicationManager } from './managers/CommunicationManager';
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
import { IdentityTokenManager } from './managers/IdentityTokenManager';
import { ObservationManager } from './managers/ObservationManager';
import { RelatedPersonManager } from './managers/RelatedPersonManager';
import { ConsentManager } from './managers/ConsentManager';
import { SmartAuthorizationManager } from './managers/auth/SmartAuthorizationManager';
import { AppAuthorizationManager } from './managers/AppAuthorizationManager';
import { FamilyManager } from './managers/FamilyManager';
import { FirebaseTokenVerifier } from './auth/FirebaseTokenVerifier';
import * as fs from 'fs';

// Load the pre-generated swagger spec. This is the static base.
let swaggerSpec: any;
try {
  const swaggerSpecPath = path.resolve(process.cwd(), 'swagger-spec.json');
  swaggerSpec = JSON.parse(fs.readFileSync(swaggerSpecPath, 'utf8'));
} catch (error) {
  console.warn(`WARN: Could not load swagger-spec.json. Did you run \`npm run build\`? Error: ${error}`);
  swaggerSpec = {
    openapi: '3.0.0',
    info: { title: 'Swagger Spec Not Found', version: '0.0.0' },
    paths: {},
  };
}



// ===================================================================================
// CONFIGURATION LOGIC - INTERNAL TO SERVER.TS
// ===================================================================================

let configInstance: IServerConfig;

function determineApiBaseUrl(port: number, apiHostname: string): string {
  // 1. Highest Priority: Use the canonical external domain if it's provided.
  if (process.env.HOST_EXTERNAL_DOMAIN) {
    // Ensure it's a clean domain without protocol, then add https.
    const domain = process.env.HOST_EXTERNAL_DOMAIN.replace(/^(https?:\/\/)/, '').replace(/\/$/, '');
    return `https://${domain}`;
  }
  // 2. Second Priority: Use the specific Cloud Run deployment URL if provided.
  if (process.env.HOST_DEPLOY_URL) {
    return process.env.HOST_DEPLOY_URL.replace(/\/$/, ''); // Remove trailing slash
  }
  // 3. Fallback for Local Development: Construct from internal binding info.
  const protocol = 'http'; // Local is always http
  const publicHost = (apiHostname === '0.0.0.0' || apiHostname === '127.0.0.1')
    ? 'localhost'
    : apiHostname;
  return `${protocol}://${publicHost}:${port}`;
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
    const port = parseInt(process.env.PORT || process.env.HOST_INTERNAL_PORT || '3000', 10);
    const isCloudRun = Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.K_CONFIGURATION);
    const apiHostname = isCloudRun ? '0.0.0.0' : (process.env.HOST_INTERNAL_IP || 'localhost');
    const apiBaseUrl = determineApiBaseUrl(port, apiHostname);

    const localServiceRoles = (process.env.LOCAL_SERVICE_ROLE || 'HOST')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    configInstance = {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: port,
      apiHostname, // Internal binding hostname
      hostExternalDomain: process.env.HOST_EXTERNAL_DOMAIN || new URL(apiBaseUrl).host, // Use .host to include the port
      apiBaseUrl: apiBaseUrl, // Use the definitive URL here
      namespace: process.env.URN_NAMESPACE || 'antifraud',
      sectorsAllowed: parseAndValidateSectors(process.env.SECTORS_ALLOWED),
  allowedPaymentMethods: (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(','),
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
      legacySignAlg: (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
        ? process.env.LEGACY_SIGN_ALG
        : 'ES384',
      legacyX509DerBase64: process.env.LEGACY_X509_DER_BASE64,
      legacyX509ChainBase64: process.env.LEGACY_X509_CHAIN_BASE64
        ? process.env.LEGACY_X509_CHAIN_BASE64.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      localServiceRoles,
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
  const hostClaims: ClaimsRecord = {
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
  if (process.env.ORG_HOST_TERMS_URL) {
    hostClaims[ClaimsServiceSchemaorg.termsOfService] = process.env.ORG_HOST_TERMS_URL;
  }

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
  /** When false, builds the app without binding a TCP port (sandbox-safe for tests). */
  listen?: boolean;
}

/**
 * Initializes and starts the Express server.
 */
async function startServer(options?: StartServerOptions) {
  const config = getConfig();

  // Initialize a baseline Swagger server URL; /swagger-spec.json will refine it per-request.
  if (swaggerSpec.info.title !== 'Swagger Spec Not Found') {
    swaggerSpec.servers = [{
      url: config.apiBaseUrl,
      description: `Server URL for ${config.nodeEnv} environment`,
    }];
  }

  // const app = express.default();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json({ type: ['application/json', 'application/fhir+json', 'application/didcomm-plaintext+json'] }));

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

  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger, // Inject logger
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
  const openIdAuthManager = new OpenIdAuthManager(kmsService, tenantManager, vaultRepository);
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

  const managerRegistry: ManagerRegistry = {
    hostingManager,
    tenantManager,
    identityTokenManager,
    observationManager,
    relatedPersonManager,
    familyManager,
    employeeManager,
    individualManager,
    consentManager,
    compositionManager,
    communicationManager,
    deviceRegistrationManager,
    licenseManager,
    openIdAuthManager,
  };
  const worker = new Worker(managerRegistry, config.apiBaseUrl, kmsService);
  const asyncResponseStore = new AsyncResponseStoreMem();
  const queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
  
  // This is the FHIR-specific AuthorizationManager, not our AppAuthorizationManager.
  const authManager: IAuthorizationManager = options?.authManager || new SmartAuthorizationManager();

  const discoveryRouter = createDiscoveryRouter(tenantManager, discoveryService, kmsService, logger);

  const authorityArtifacts: Record<string, ReturnType<typeof loadAuthorityArtifacts>> = {};
  const roles = new Set(config.localServiceRoles || []);
  if (roles.has('CA') || roles.has('ICA')) {
    const artifactsRoot = path.join(process.cwd(), 'artifacts');
    const rootDir = process.env.LOCAL_CA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-root-ca');
    const icaDir = process.env.LOCAL_ICA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-ica');
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
  const apiRouter = createApiRouter(queueAdapter, tenantManager, kmsService, asyncResponseStore, vaultRepository, cryptographyService, config.apiBaseUrl, appAuthManager);
  const networkRouter = createNetworkRouter(queueAdapter, kmsService);
  const fhirRouter = createFhirRouter(queueAdapter, authManager);
  const webhooksRouter = createWebhooksRouter(queueAdapter);
  const authRouter = createAuthRouter(appAuthManager, tokenManager);
  app.use('/', discoveryRouter);
  if (authorityRouter) {
    app.use('/', authorityRouter);
  }
  app.use('/', apiRouter);
  app.use('/', networkRouter);
  app.use('/', fhirRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/auth', authRouter);

  // --- Global Error Handling Middleware (MUST be the LAST middleware) ---
  app.use(createGlobalErrorHandler(logger));

  app.get('/swagger-spec.json', (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (swaggerSpec.info.title === 'Swagger Spec Not Found') {
      res.json(swaggerSpec);
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
      ...swaggerSpec,
      servers: [{
        url: baseUrl,
        description: `Server URL for ${config.nodeEnv} environment`,
      }],
    });
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(null, {
    swaggerOptions: { url: '/swagger-spec.json' },
  }));

  const server =
    options?.listen === false
      ? undefined
      : app.listen(config.port, config.apiHostname, () => {
          console.log(`[GW-API] Listening on ${config.apiHostname}:${config.port}`);
        });

  return { app, server, queueAdapter, tenantManager, vaultRepository, cryptographyService, blockchainAdapter, kmsService };
}

export { startServer };
