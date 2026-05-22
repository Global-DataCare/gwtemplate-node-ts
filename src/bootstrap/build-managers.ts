import type { IServerConfig } from '../config';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { TenantsCacheManager } from '../managers/TenantsCacheManager';
import type { IStorageAdapter } from '../database/storage/IStorageAdapter';
import type { ILogger } from '../loggers/ILogger';
import { HostingManager } from '../managers/HostingManager';
import { IcaManager } from '../managers/IcaManager';
import { MessagingManager } from '../managers/MessagingManager';
import { EmployeeManager } from '../managers/EmployeeManager';
import { CredentialManager } from '../managers/CredentialManager';
import { BlockchainAdapterMem } from '../adapters/BlockchainAdapterMem';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { CredentialLedgerAdapterMem } from '../adapters/CredentialLedgerAdapterMem';
import { CredentialLedgerAdapterFabric } from '../adapters/CredentialLedgerAdapterFabric';
import { CredentialLedgerAdapterMulti } from '../adapters/CredentialLedgerAdapterMulti';
import { CredentialLedgerResolver, parseLedgerProviderMap } from '../adapters/credential-ledger-resolver';
import type { ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { IndividualManager } from '../managers/IndividualManager';
import { FamilyManager } from '../managers/FamilyManager';
import { CompositionManager } from '../managers/CompositionManager';
import { DocumentReferenceManager } from '../managers/DocumentReferenceManager';
import { CommunicationManager } from '../managers/CommunicationManager';
import { DeviceRegistrationManager } from '../managers/DeviceRegistrationManager';
import { LicenseManager } from '../managers/LicenseManager';
import { AppAuthorizationManager } from '../managers/AppAuthorizationManager';
import { resolveTokenVerifierFromEnv } from '../auth/token-verifier-registry';
import { TokenManager } from '../managers/TokenManager';
import { IdentityTokenManager } from '../managers/IdentityTokenManager';
import { OpenIdAuthManager } from '../managers/OpenIdAuthManager';
import { ObservationManager } from '../managers/ObservationManager';
import { MedicationStatementManager } from '../managers/MedicationStatementManager';
import { RelatedPersonManager } from '../managers/RelatedPersonManager';
import { ConsentManager } from '../managers/ConsentManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { ClearingHouseService } from '../services/ClearingHouseService';
import type { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * Builds the manager registry used by the worker/router runtime.
 *
 * Design intent:
 * - keep core managers always available
 * - keep optional capabilities pluggable behind configuration and service exposure
 */
export function buildManagers(options: {
  config: IServerConfig;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: TenantsCacheManager;
  storageAdapter: IStorageAdapter;
  logger: ILogger;
  cryptographyService: CryptographyService;
}) {
  const { config, vaultRepository, kmsService, tenantManager, storageAdapter, logger, cryptographyService } = options;

  const clearingHouseService = new ClearingHouseService();
  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
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

  const compositionManager = new CompositionManager(vaultRepository, blockchainAdapter);
  const documentReferenceManager = new DocumentReferenceManager(vaultRepository, blockchainAdapter);
  const communicationManager = new CommunicationManager({ tenantsCacheManager: tenantManager, vaultRepository });
  const deviceRegistrationManager = new DeviceRegistrationManager(config.apiBaseUrl, vaultRepository, kmsService);
  const licenseManager = new LicenseManager(vaultRepository, kmsService);
  const tokenVerifier = resolveTokenVerifierFromEnv(isTestEnv);
  const appAuthManager = new AppAuthorizationManager(
    vaultRepository,
    tokenVerifier,
    kmsService,
    cryptographyService,
  );
  const tokenManager = new TokenManager(kmsService, tenantManager);
  const identityTokenManager = new IdentityTokenManager(appAuthManager, tokenManager);
  const openIdAuthManager = new OpenIdAuthManager(kmsService, tenantManager, vaultRepository, clearingHouseService);
  const observationManager = new ObservationManager(vaultRepository, blockchainAdapter);
  const medicationStatementManager = new MedicationStatementManager(vaultRepository);
  const relatedPersonManager = new RelatedPersonManager(vaultRepository, blockchainAdapter);
  const consentManager = new ConsentManager({ vaultRepository, blockchainAdapter });
  const discoveryService = new DiscoveryService(tenantManager);

  return {
    hostingManager,
    icaManager,
    messagingManager,
    employeeManager,
    credentialManager,
    blockchainAdapter,
    credentialLedgerAdapter,
    individualManager,
    familyManager,
    compositionManager,
    documentReferenceManager,
    communicationManager,
    deviceRegistrationManager,
    licenseManager,
    appAuthManager,
    tokenManager,
    identityTokenManager,
    openIdAuthManager,
    observationManager,
    medicationStatementManager,
    relatedPersonManager,
    consentManager,
    discoveryService,
    clearingHouseService,
  };
}
