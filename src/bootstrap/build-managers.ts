import { resolveProfessionalHomeVault } from './resolve-professional-home-vault';
import { buildActivationClearingHouse } from './build-activation-clearing-house';
import { IcaCredentialStatusClient } from '../services/IcaCredentialStatusClient';
import { randomUUID } from 'node:crypto';
import { getTenantVaultIdFromIss } from '../utils/tenant';
import type { IServerConfig } from '../config';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IStorageAdapter } from '../database/storage/IStorageAdapter';
import type { ILogger } from '../loggers/ILogger';
import { HostingManager } from '../managers/HostingManager';
import { IcaManager } from '../managers/IcaManager';
import { MessagingManager } from '../managers/MessagingManager';
import { EmployeeManager } from '../managers/EmployeeManager';
import { CredentialManager } from '../managers/CredentialManager';
import { BlockchainAdapterMem } from '../adapters/BlockchainAdapterMem';
import { BlockchainAdapterFabric } from '../adapters/BlockchainAdapterFabric';
import { BlockchainAdapterMulti } from '../adapters/BlockchainAdapterMulti';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { CredentialLedgerAdapterMem } from '../adapters/CredentialLedgerAdapterMem';
import { CredentialLedgerAdapterFabric } from '../adapters/CredentialLedgerAdapterFabric';
import { CredentialLedgerAdapterMulti } from '../adapters/CredentialLedgerAdapterMulti';
import {
  CredentialLedgerResolver,
  parseLedgerProviderMap,
  shouldUseFabricLedger,
} from '../adapters/credential-ledger-resolver';
import type { ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { IndividualManager } from '../managers/IndividualManager';
import { FamilyManager } from '../managers/FamilyManager';
import { CompositionManager } from '../managers/CompositionManager';
import { TwinCompositionManager } from '../managers/TwinCompositionManager';
import { DocumentReferenceManager } from '../managers/DocumentReferenceManager';
import { CommunicationManager } from '../managers/CommunicationManager';
import { SubscriptionManager } from '../managers/SubscriptionManager';
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
import { buildLocalClearingHouseVerifier } from './build-clearing-house-verifier';
import type { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { composeHostDidWebId } from '../utils/did-backend';
import type { ITenantsManager } from '../managers/ITenantsManager';
import type { ITenantDidRegistryMutator } from '../managers/ITenantDidRegistryMutator';
import type { IHostingTenantRegistry } from '../managers/IHostingTenantRegistry';
import type { IDiscoveryTenantRegistry } from '../managers/IDiscoveryTenantRegistry';
import type { IApiTenantRegistry } from '../managers/IApiTenantRegistry';
import type { ILedgerTenantRegistry } from '../managers/ILedgerTenantRegistry';
import { buildBreakGlassAuthorizer } from '../security/break-glass';

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * Aggregate capability contract required by the runtime manager wiring.
 *
 * @security
 * This keeps the bootstrap layer honest: it depends on the minimum set of
 * interfaces needed to assemble the application, instead of depending on the
 * concrete `TenantsCacheManager` implementation directly.
 *
 * The concrete implementation may still be `TenantsCacheManager`, but that
 * choice is made by the composition root, not by the manager registry type.
 */
type IManagerRuntimeTenantRegistry =
  ITenantsManager
  & ITenantDidRegistryMutator
  & IHostingTenantRegistry
  & IDiscoveryTenantRegistry
  & IApiTenantRegistry
  & ILedgerTenantRegistry;

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
  tenantManager: IManagerRuntimeTenantRegistry;
  hostCollectionName: string;
  storageAdapter: IStorageAdapter;
  logger: ILogger;
  cryptographyService: CryptographyService;
}) {
  const { config, vaultRepository, kmsService, tenantManager, storageAdapter, logger, cryptographyService } = options;
  const hostRuntime = {
    hostCollectionName: options.hostCollectionName,
    hostDid: composeHostDidWebId(config.apiBaseUrl, config.hostExternalDomain),
  };

  const credentialLedgerMem = new CredentialLedgerAdapterMem();
  const credentialLedgerFabric = new CredentialLedgerAdapterFabric();
  const ledgerProviderMap = parseLedgerProviderMap(process.env.LEDGER_PROVIDER_MAP);
  const ledgerDefaultProvider = process.env.LEDGER_PROVIDER_DEFAULT || 'mem';
  const ledgerProviders: Record<string, ICredentialLedgerAdapter> = {
    mem: credentialLedgerMem,
    fabric: credentialLedgerFabric,
    multi: new CredentialLedgerAdapterMulti([credentialLedgerMem, credentialLedgerFabric]),
  };
  const credentialLedgerAdapter = new CredentialLedgerResolver({
    defaultProvider: ledgerDefaultProvider,
    providerMap: ledgerProviderMap,
    providers: ledgerProviders,
  });
  const verifierProvider = credentialLedgerAdapter.resolveProviderName(config.networkMode);
  const verifierUsesFabric = config.networkMode !== 'test' && ['fabric', 'multi'].includes(verifierProvider);
  const localClearingHouseVerifier = buildLocalClearingHouseVerifier({ network: config.networkMode, ledgerKind: verifierUsesFabric ? 'fabric' : 'memory',
    tenants: tenantManager, ledger: verifierUsesFabric ? credentialLedgerFabric : credentialLedgerMem,
    vaultRepository, kmsService, cryptography: cryptographyService, authorize: (request, identity) => openIdAuthManager.verifyCurrentConsentContext(request, identity) });
  const clearingHouseService = new ClearingHouseService({ cryptography: cryptographyService, localVerifier: localClearingHouseVerifier,
    signClientAssertion: async ({ tenantDid, tenantVaultId, audience, requestHash }) => {
      const vaultId = tenantVaultId || (tenantDid === hostRuntime.hostDid ? 'host' : getTenantVaultIdFromIss(tenantDid));
      if ((await tenantManager.getDidDocument(vaultId))?.id !== tenantDid) throw new Error('Verifier requester vault does not match its registered DID.');
      const key = await kmsService.getPublicVerificationKey(vaultId, undefined, 'comm_sig');
      if (!key?.kid) throw new Error('Verifier client signing key is unavailable.');
      const now = Math.floor(Date.now() / 1000);
      return kmsService.createCompactJws({ iss: tenantDid, sub: tenantDid, aud: audience, iat: now, exp: now + 60, jti: randomUUID(), request_hash: requestHash }, key.kid, vaultId, 'comm_sig', { typ: 'JWT' });
    },
  });
  const activationIssuerTrust = (issuer: string) => {
    const entries = JSON.parse(process.env.CREDENTIAL_TRUSTED_ISSUERS_JSON || '{}');
    if (!Object.prototype.hasOwnProperty.call(entries, issuer) || !Array.isArray(entries[issuer]?.jwks?.keys)
      || entries[issuer].status !== 'active' || typeof entries[issuer].statusEndpointTemplate !== 'string') throw new Error('Active ICA issuer keys and credential status endpoint must be configured.');
    return entries[issuer];
  };
  const icaStatusClient = new IcaCredentialStatusClient({ resolveEndpoint: issuer => activationIssuerTrust(issuer).statusEndpointTemplate });
  const activationClearingHouseService = buildActivationClearingHouse({ hostDid: hostRuntime.hostDid, cryptography: cryptographyService,
    allowLegacyRepresentativeBootstrap: process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER === 'true',
    resolveIssuer: async issuer => activationIssuerTrust(issuer), checkCredentialStatus: credential => icaStatusClient.check(credential) });
  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
    config,
    hostRuntime,
    activationClearingHouseService,
    undefined,
    cryptographyService,
  );
  const icaManager = new IcaManager(vaultRepository, kmsService);
  const messagingManager = new MessagingManager(vaultRepository, kmsService);
  const employeeManager = new EmployeeManager(vaultRepository, kmsService, tenantManager, tenantManager, hostRuntime);
  const credentialManager = new CredentialManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config.hostExternalDomain,
  );
  const blockchainAdapterMem = new BlockchainAdapterMem();
  const blockchainAdapterFabric = shouldUseFabricLedger() ? new BlockchainAdapterFabric() : undefined;
  const blockchainAdapter: IBlockchainAdapter = blockchainAdapterFabric
    ? new BlockchainAdapterMulti({ discoveryAdapter: blockchainAdapterMem, writeAdapter: blockchainAdapterFabric })
    : blockchainAdapterMem;


  const individualManager = new IndividualManager(
    vaultRepository,
    kmsService,
    tenantManager,
    credentialManager,
    blockchainAdapter,
    hostRuntime,
  );

  const familyManager = new FamilyManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
    config,
  );

  const compositionManager = new CompositionManager(vaultRepository, blockchainAdapter, tenantManager);
  const twinCompositionManager = new TwinCompositionManager(vaultRepository, compositionManager);
  const documentReferenceManager = new DocumentReferenceManager(vaultRepository, blockchainAdapter, tenantManager);
  const communicationManager = new CommunicationManager({
    tenantsCacheManager: tenantManager,
    vaultRepository,
    compositionManager,
    individualManager,
    blockchainAdapter,
  });
  const subscriptionManager = new SubscriptionManager({ vaultRepository, kmsService, tenantsCacheManager: tenantManager });
  const deviceRegistrationManager = new DeviceRegistrationManager(config.apiBaseUrl, vaultRepository, kmsService, tenantManager);
  const licenseManager = new LicenseManager(vaultRepository, kmsService, tenantManager);
  const tokenVerifier = resolveTokenVerifierFromEnv(isTestEnv);
  const appAuthManager = new AppAuthorizationManager(
    vaultRepository,
    tokenVerifier,
    kmsService,
    cryptographyService,
  );
  const tokenManager = new TokenManager(kmsService, tenantManager);
  const identityTokenManager = new IdentityTokenManager(appAuthManager, tokenManager);
  const openIdAuthManager = new OpenIdAuthManager(
    kmsService,
    tenantManager,
    vaultRepository,
    clearingHouseService,
    buildBreakGlassAuthorizer(blockchainAdapter, vaultRepository),
    { cryptography: cryptographyService, apiBaseUrl: config.apiBaseUrl,
      resolveClientRegistrationVault: (actorDid, fallbackVault) => resolveProfessionalHomeVault(tenantManager, actorDid, fallbackVault) },
  );
  const observationManager = new ObservationManager(vaultRepository, blockchainAdapter, tenantManager);
  const medicationStatementManager = new MedicationStatementManager(vaultRepository, tenantManager, blockchainAdapter);
  const relatedPersonManager = new RelatedPersonManager(vaultRepository, blockchainAdapter, tenantManager);
  const consentManager = new ConsentManager({ vaultRepository, blockchainAdapter, tenantsCacheManager: tenantManager });
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
    twinCompositionManager,
    documentReferenceManager,
    communicationManager,
    subscriptionManager,
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
    localClearingHouseVerifier,
    clearingHouseService,
  };
}
