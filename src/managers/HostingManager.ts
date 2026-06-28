// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { IServerConfig } from '../config';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { BundleJsonApi, BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { DidDocument } from 'gdc-common-utils-ts/models/did';
import { OrganizationConfig } from '../gdc-backend-utils-node/models/entity';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { DidCommDecodedMetadata, IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { validateNewOrganizationClaims } from '../utils/claims-validator';
import { applyLegacyX509Metadata, composeHostDidWebId, createHostedDidWeb, getBaseUrlFromDidWeb, populateDidDocumentFromJwks } from '../utils/did-backend';
import { populateDidDocumentServices } from '../utils/did-document';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../utils/services';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { AllowedIndexableClaims } from '../gdc-backend-utils-node/models/indexing';
import { createEmployeeUrn, createOrganizationUrn, parseTenantUrn } from '../utils/urn';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../utils/credential-generators';
import { ILogger } from '../loggers/ILogger';
import type { IHostingTenantRegistry } from './IHostingTenantRegistry';
import type { IHostRuntime } from './IHostRuntime';
import { generateLicenseOffer } from '../utils/offer';
import { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { EntityLifecycleStatus, EntityType, NetworkAccessStatus, NetworkName, BundleEntryType } from '../gdc-backend-utils-node/models/enums';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { VerificationMethod } from 'gdc-common-utils-ts/models/did';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool } from '../utils/license-issuance';
import { buildPaymentCommunication, readOfferPaymentContext } from '../utils/order-communication';
import { buildGatewayInvoiceBundle } from '../utils/invoice-bundle';
import { verifyOrderPaymentConfirmation } from '../utils/payment-confirmation';
import { buildPdfSignatureEvidence, PdfSignatureEvidence } from '../utils/pdf-evidence';
import { getPersonOccupationClaim } from '../utils/occupation';
import { slugFromDomain } from '../utils/slug';
import { getEnvSectionId } from '../utils/section-env';
import { normalizeIndexedEmail, splitIndexedEmails, splitIndexedPhones } from '../utils/indexed-contact';
import {
  buildOfferOrderIndexedAttributes,
  readProjectedOfferOrderClaims,
} from '../utils/offer-order-read-model';
import { HostingOfferOrderService } from './hosting/HostingOfferOrderService';
import { HostingLifecycleService } from './hosting/HostingLifecycleService';
import { SERVICE_ADDITIONAL_TYPE_CLAIM } from '../utils/service-capability-claims';
import { ClearingHouseService, IClearingHouseService } from '../services/ClearingHouseService';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import {
  parseServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  validateActivationServiceAuthorizationPolicy,
} from 'gdc-common-utils-ts/utils/activation-policy';
import {
  DefaultActivationTrustAdapter,
  IActivationTrustAdapter,
} from '../adapters/activation-trust.adapter';
import {
  applyTenantAuthorizationStatus,
  getTenantAuthorizationStatus,
  TenantAuthorizationLifecycleStatus,
} from '../utils/tenant-lifecycle';
import {
  ACTION_DISABLE,
  ACTION_ENABLE,
  ACTION_PURGE,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { registerOrganizationOnLedger } from '../utils/ledger-organization-registration';
import { OrganizationDidBindingEntryTypes } from 'gdc-common-utils-ts/utils/organization-did-binding';
import {
  DIDCOMM_DEFAULT_ACCEPT_HEADER,
  DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
} from 'gdc-common-utils-ts/utils/didcomm-submit';

// Transitional ICA transport contract:
// GW host routes use the newer `application/didcomm-plain+json`, but the
// current dataspace-ica-ts `_verify` endpoint still expects the legacy plain
// DIDComm media type on this internal forward hop.
const ICA_DIDCOMM_PLAIN_JSON_MEDIA_TYPE = 'application/didcomm-plain+json';

type ActivationParticipantMaterial = {
  did?: string;
  sameAs?: string;
  publicKeyJwk?: PublicJwk;
  jwks?: JwkSet;
};

type ActivationMaterial = {
  vpToken: any;
  presentationSubmission: any;
  organizationCredential: any;
  representativeCredential: any;
  legacyOrganizationCredential: any;
  legacyRepresentativeCredential: any;
  primaryDid: any;
  publicTenantUrl: any;
  organizationBinding?: ActivationParticipantMaterial;
  controllerBinding?: ActivationParticipantMaterial;
};

type VpCredentialObject = Record<string, unknown>;
type LegalOrganizationVerificationTransactionResource = Readonly<{
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  legalRepresentativePayload?: Record<string, unknown>;
  legalRepresentative?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}>;

type LegalOrganizationVerificationTransactionEntry = Readonly<{
  type?: string;
  meta?: {
    claims?: ClaimsRecord;
  };
  resource?: LegalOrganizationVerificationTransactionResource;
}>;
type LegalOrganizationVerificationTransactionNextStep = Readonly<{
  action: 'Order/_batch';
  acceptedOffer: {
    identifier?: string;
    identifierClaim: typeof ClaimsOrderSchemaorg.acceptedOfferIdentifier;
  };
}>;
type LegalOrganizationVerificationTransactionResponseResource = Readonly<{
  icaResponse: unknown;
  next: LegalOrganizationVerificationTransactionNextStep;
}>;
type LegalOrganizationIssueResponseResource = Readonly<{
  icaResponse: unknown;
}>;
const ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE_TYPE = 'Organization-verification-transaction-response-v1.0';
const ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST_TYPE = 'Organization-verification-transaction-request-v1.0';
const ORGANIZATION_VERIFICATION_TRANSACTION_NEXT_ACTION = 'Order/_batch';
const ORGANIZATION_ISSUE_RESPONSE_TYPE = 'Organization-issue-response-v1.0';
/**
 * Technical runtime marker copied outside encrypted employee content for the
 * host bootstrap controller created during tenant onboarding.
 *
 * Why this exists:
 * - the bootstrap controller is an implementation detail needed to initialize
 *   the hosted tenant
 * - tenant lifecycle scans must ignore this synthetic employee so it does not
 *   block later `disable` or `purge` operations
 *
 * The canonical business role remains inside protected claims and, when
 * searchable, in `indexed.attributes`. This marker is only a lightweight
 * operational projection for lifecycle inspection.
 */
const HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE = 'host-bootstrap-controller';
const JWK_THUMBPRINT_SHA256_URN_PREFIX = 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:';

/**
 * Manages the initial onboarding of new tenants onto the Gateway.
 *
 * @architecture
 * This manager's responsibility is strictly limited to the **Phase 1 Onboarding** process, which grants
 * a new tenant an active account on the Gateway and automatically enables them for the `test` network.
 *
 * It follows a two-step Offer/Order pattern:
 * 1.  `processOrganizationRegistration`: Creates a provisional (`pending`) tenant record and returns an `Offer`.
 * 2.  `processOrder`: Finalizes the registration upon `Order` confirmation, activates the tenant for the `test`
 *     network, and creates a provisional, host-signed `legal-participant.vc.json` to facilitate frontend development and testing.
 *
 * The subsequent, more complex process of onboarding to the `production` network is handled by a separate
 * set of managers (e.g., `NetworkEnrollmentManager`) and is initiated by a separate user action.
 */
export class HostingManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: IHostingTenantRegistry;
  private storageAdapter: IStorageAdapter;
  private logger: ILogger;
  private config: IServerConfig;
  private hostRuntime: IHostRuntime;
  private clearingHouseService: IClearingHouseService;
  private activationTrustAdapter: IActivationTrustAdapter;
  private offerOrderService: HostingOfferOrderService;
  private lifecycleService: HostingLifecycleService;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: IHostingTenantRegistry,
    storageAdapter: IStorageAdapter,
    logger: ILogger,
    config: IServerConfig,
    hostRuntime: IHostRuntime,
    clearingHouseService?: IClearingHouseService,
    activationTrustAdapter?: IActivationTrustAdapter,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.storageAdapter = storageAdapter;
    this.logger = logger;
    this.config = config;
    this.hostRuntime = hostRuntime;
    this.clearingHouseService = clearingHouseService || new ClearingHouseService();
    this.activationTrustAdapter = activationTrustAdapter || new DefaultActivationTrustAdapter(this.clearingHouseService);
    this.offerOrderService = new HostingOfferOrderService(
      this.vaultRepository,
      this.kmsService,
      this.tenantsCacheManager,
      this.config,
      this.hostRuntime,
    );
    this.lifecycleService = new HostingLifecycleService(
      this.vaultRepository,
      this.kmsService,
      this.tenantsCacheManager,
      this.config,
      this.hostRuntime,
      (error, type, meta) => this.handleError(error, type, meta),
    );
  }

  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    const { organization, person, service } = this.extractResources(hostClaims);
    const processedService = await this._handleServiceAttachment(service);
    const allClaims = { ...hostClaims, ...(processedService?.meta.claims || {}) };
    await this.persistHostConfig(organization, allClaims, [person, processedService!]);
  }

  /**
   * Reconciles the persisted host runtime registration with the current code-defined
   * service surface.
   *
   * Why this exists:
   * - the host tenant record is persisted once and then reused across restarts
   * - newly added host runtime endpoints (for example `Organization/_transaction`)
   *   will not become routable if the stored `didConfig.service` remains stale
   * - startup must therefore refresh the host runtime projection without
   *   re-running the full bootstrap or mutating business identity claims
   *
   * What this updates:
   * - `didConfig.service`
   * - `didDocument.service`
   * - legacy x509 metadata derived from runtime config
   * - `meta.lastUpdated`
   *
   * What this preserves:
   * - host claims and identity
   * - host keys / verification methods
   * - well-known VCs and other persisted host artifacts
   *
   * @returns `true` when the stored host runtime projection was rewritten,
   *          otherwise `false`.
   */
  public async reconcilePersistedHostRuntimeConfig(): Promise<boolean> {
    const hostCollectionName = this.hostRuntime.hostCollectionName;
    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }

    const existingSecureDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      hostCollectionName,
      'host',
      getEnvSectionId('tenants'),
    );
    if (!existingSecureDoc) {
      return false;
    }

    const hostConfig = await this.kmsService.unprotectConfidentialData<OrganizationConfig>(existingSecureDoc, 'host');
    if (!hostConfig?.claims) {
      throw new ManagerError('Host tenant record is invalid or missing claims.', IssueType.Exception);
    }

    const expectedDidConfigServices = initializeHostServicesConfig(
      this.config.sectorsAllowed,
      this.config.nodeEnv,
      this.config.networkMode,
    );
    const didId = String(hostConfig.didDocument?.id || composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain));
    const didDocument = {
      '@context': hostConfig.didDocument?.['@context'] || 'https://www.w3.org/ns/did/v1',
      ...hostConfig.didDocument,
      id: didId,
      alsoKnownAs: Array.isArray(hostConfig.didDocument?.alsoKnownAs) ? hostConfig.didDocument?.alsoKnownAs : [],
    } as DidDocument;
    const nextDidDocumentServices = populateDidDocumentServices(
      didId,
      this.config.apiBaseUrl,
      expectedDidConfigServices,
      false,
      {} as any,
    );
    applyLegacyX509Metadata(
      didDocument,
      this.config.legacySignAlg,
      this.config.legacySignAlg && this.config.legacyX509DerBase64
        ? `${this.config.apiBaseUrl}/host/cds-${this.config.host.coverageScope || 'EU'}/v1/${this.config.networkMode}/.well-known/x509.der`
        : undefined,
      this.config.legacyX509DerBase64
        ? [this.config.legacyX509DerBase64, ...(this.config.legacyX509ChainBase64 || [])]
        : this.config.legacyX509ChainBase64,
    );

    const previousDidConfigServices = JSON.stringify(hostConfig.didConfig?.service || []);
    const expectedDidConfigServicesJson = JSON.stringify(expectedDidConfigServices);
    const previousDidDocumentServices = JSON.stringify(hostConfig.didDocument?.service || []);
    const expectedDidDocumentServicesJson = JSON.stringify(nextDidDocumentServices);

    if (
      previousDidConfigServices === expectedDidConfigServicesJson
      && previousDidDocumentServices === expectedDidDocumentServicesJson
    ) {
      const refreshTenant = (this.tenantsCacheManager as any)?.refreshTenant;
      if (typeof refreshTenant === 'function') {
        await refreshTenant.call(this.tenantsCacheManager, 'host');
      }
      return false;
    }

    didDocument.service = nextDidDocumentServices;
    const nextHostConfig: OrganizationConfig = {
      ...hostConfig,
      didConfig: {
        ...(hostConfig.didConfig || {}),
        service: expectedDidConfigServices,
      },
      didDocument,
      meta: {
        ...(hostConfig.meta || {}),
        lastUpdated: new Date().toISOString(),
      },
    };

    const nextSecureDoc: ConfidentialStorageDoc = {
      ...existingSecureDoc,
      status: nextHostConfig.status || existingSecureDoc.status,
      content: nextHostConfig,
    };
    const protectedDoc = await this.kmsService.protectConfidentialData(nextSecureDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [protectedDoc], getEnvSectionId('tenants'));

    const refreshTenant = (this.tenantsCacheManager as any)?.refreshTenant;
    if (typeof refreshTenant === 'function') {
      await refreshTenant.call(this.tenantsCacheManager, 'host');
    }
    return true;
  }

  /**
   * Normalizes the legal-organization identity claims used by host onboarding.
   *
   * Precedence rules:
   * - If `identifier.value` is already present, it is treated as the canonical
   *   legal identifier for onboarding and path routing.
   * - If `identifier.value` is missing but ICA provides
   *   `organizationCredential.credentialSubject.taxID`, that tax ID backfills
   *   `identifier.value`.
   * - If `identifier.type` is missing, GW infers `UUID` for UUID values and
   *   otherwise falls back to `TAX`.
   * - If `alternateName` is missing for a legal organization, GW derives it
   *   from the final canonical `identifier.value`.
   *
   * This makes the path-facing tenant id (`alternateName`) explicit:
   * - tax-id-only onboarding becomes `taxID -> identifier.value -> alternateName`
   * - if a jurisdiction uses a different legal identifier (for example, a
   *   Canadian incorporation number) and sends it in `identifier.value`, that
   *   legal identifier wins over `taxID` for `alternateName`, `tenantId`, and
   *   `vaultId`.
   */
  private applyLegalOrganizationIdentityCompatibility(
    claims: ClaimsRecord,
    organizationCredential?: unknown,
  ): ClaimsRecord {
    const processedClaims = { ...claims };
    const alternateName = String(processedClaims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
    const isIndividualOrg = !!processedClaims['org.schema.Organization.owner.telephone'];
    const identifierValue = String(processedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
    const identifierType = String(processedClaims[ClaimsOrganizationSchemaorg.identifierType] || '').trim();
    const subject = Array.isArray((organizationCredential as any)?.credentialSubject)
      ? (organizationCredential as any).credentialSubject[0]
      : (organizationCredential as any)?.credentialSubject;
    const taxId = String(subject?.taxID || '').trim();

    if (!identifierValue && taxId) {
      processedClaims[ClaimsOrganizationSchemaorg.identifierValue] = taxId;
    }
    const finalIdentifierValue = String(processedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
    const normalizedUuidValue = finalIdentifierValue.startsWith('urn:uuid:')
      ? finalIdentifierValue.slice('urn:uuid:'.length)
      : finalIdentifierValue;
    if (!identifierType && finalIdentifierValue) {
      processedClaims[ClaimsOrganizationSchemaorg.identifierType] = uuidValidate(normalizedUuidValue) ? 'UUID' : 'TAX';
    }
    if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      const inferredCountry = this.inferJurisdictionFromLegalIdentifier(taxId || finalIdentifierValue);
      if (inferredCountry) {
        processedClaims[ClaimsOrganizationSchemaorg.addressCountry] = inferredCountry;
      }
    }
    if (!alternateName && !isIndividualOrg && finalIdentifierValue) {
      processedClaims[ClaimsOrganizationSchemaorg.alternateName] = finalIdentifierValue;
    }
    return processedClaims;
  }

  private inferJurisdictionFromLegalIdentifier(identifierValue?: string): string | undefined {
    const normalized = String(identifierValue || '').trim().toUpperCase();
    if (!normalized) return undefined;
    if (normalized.startsWith('VATES-')) return 'ES';
    const vatCountryMatch = /^VAT([A-Z]{2})[-:]?/.exec(normalized);
    if (vatCountryMatch?.[1]) {
      return vatCountryMatch[1];
    }
    return undefined;
  }

  /**
   * Maps a host registry sector string to a NetworkName enum value.
   *
   * @param hostSector {string} Must be a NETWORK sector ('test', 'test-network', 'network').
   * @returns {NetworkName}
   * @warning Only use for infra/host logic. Never pass a business sector here.
   * @todo If you ever change sector handling, audit all usages for sector confusion.
   */
  private mapHostRegistrySectorToNetworkName(hostSector?: string): NetworkName {
    switch (String(hostSector || '').trim().toLowerCase()) {
      case 'test-network':
        return NetworkName.TestNetwork;
      case 'network':
        return NetworkName.Production;
      case 'test':
      default:
        return NetworkName.Test;
    }
  }

  private getCurrentUrnNetwork(): 'test' | 'test-network' | 'network' {
    const mode = String(this.config.networkMode || '').trim().toLowerCase();
    if (mode === 'test' || mode === 'test-network' || mode === 'network') {
      return mode;
    }
    return 'test';
  }

  private extractDidFromCredential(credential: any): string | undefined {
    if (!credential || typeof credential !== 'object') {
      return undefined;
    }
    const subject = Array.isArray(credential.credentialSubject)
      ? credential.credentialSubject[0]
      : credential.credentialSubject;
    const didCandidate = subject?.id || credential?.id;
    return typeof didCandidate === 'string' && didCandidate.startsWith('did:web:')
      ? didCandidate
      : undefined;
  }

  private decodeVpTokenPayload(vpToken?: string): Record<string, any> | undefined {
    const raw = String(vpToken || '').trim();
    if (!raw) {
      return undefined;
    }
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    const parts = raw.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return undefined;
    }
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const parsed = JSON.parse(payloadJson);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private decodeEmbeddedCredential(candidate: unknown): VpCredentialObject | undefined {
    if (candidate && typeof candidate === 'object') {
      return candidate as VpCredentialObject;
    }
    if (typeof candidate !== 'string') {
      return undefined;
    }
    const raw = candidate.trim();
    if (!raw) {
      return undefined;
    }
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    const parts = raw.split('.');
    if (parts.length !== 3 || !parts[1]) {
      return undefined;
    }
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const parsed = JSON.parse(payloadJson);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private credentialHasAnyType(credential: VpCredentialObject | undefined, acceptedTypes: string[]): boolean {
    if (!credential) {
      return false;
    }
    const typeRaw =
      credential.type
      || (credential as any)?.vc?.type
      || (credential as any)?.credential?.type;
    const types = Array.isArray(typeRaw) ? typeRaw.map(String) : [String(typeRaw || '')];
    return acceptedTypes.some((type) => types.includes(type));
  }

  private extractCredentialFromVpToken(vpToken: string | undefined, acceptedTypes: string[]): VpCredentialObject | undefined {
    const payload = this.decodeVpTokenPayload(vpToken);
    const candidates = Array.isArray(payload?.vp?.verifiableCredential) ? payload.vp.verifiableCredential : [];
    for (const candidate of candidates) {
      const credential = this.decodeEmbeddedCredential(candidate);
      if (this.credentialHasAnyType(credential, acceptedTypes)) {
        return credential;
      }
    }
    return undefined;
  }

  private normalizeTenantPublicUrl(urlOrDomain?: string): string | undefined {
    if (!urlOrDomain || typeof urlOrDomain !== 'string') {
      return undefined;
    }
    if (urlOrDomain.startsWith('https://')) {
      return urlOrDomain;
    }
    if (urlOrDomain.startsWith('http://')) {
      return urlOrDomain.replace(/^http:\/\//, 'https://');
    }
    return `https://${urlOrDomain}`;
  }

  private normalizeTenantOperationalUrl(urlOrDomain?: string): string | undefined {
    return this.normalizeTenantPublicUrl(urlOrDomain);
  }

  private getOperationalServiceBaseUrl(claims: ClaimsRecord, options?: { operationalTenantUrl?: string; publicTenantUrl?: string; }): string | undefined {
    const serviceOperationalClaim = claims['org.schema.Service.url'] as string | undefined;
    const explicitOperationalUrl = this.normalizeTenantOperationalUrl(
      options?.operationalTenantUrl || serviceOperationalClaim,
    );
    if (explicitOperationalUrl) {
      return explicitOperationalUrl;
    }

    const normalizedPublicUrl = this.normalizeTenantPublicUrl(
      options?.publicTenantUrl || claims[ClaimsOrganizationSchemaorg.url] as string | undefined,
    );
    return normalizedPublicUrl;
  }

  private buildTenantAlsoKnownAs(params: {
    tenantUrn: string;
    primaryDid: string;
    externalDid?: string;
    hostedDid: string;
    publicTenantUrl?: string;
    hostedPublicUrl?: string;
  }): string[] {
    const aliases = [
      params.tenantUrn,
      params.publicTenantUrl,
      params.externalDid && params.primaryDid !== params.externalDid ? params.externalDid : undefined,
      params.hostedDid && params.primaryDid !== params.hostedDid ? params.hostedDid : undefined,
      params.hostedPublicUrl && params.hostedPublicUrl !== params.publicTenantUrl ? params.hostedPublicUrl : undefined,
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set(aliases));
  }

  private extractActivationMaterial(entry: BundleEntry, body: any) {
    const entryMeta = (entry?.meta || {}) as Record<string, any>;
    const entryResource = (entry?.resource || {}) as Record<string, any>;
    const vpToken = body?.vp_token || entryMeta?.vp_token || entryResource?.vp_token;
    const legacyOrganizationCredential =
      body?.organizationCredential
      || body?.organization_credential
      || entryMeta?.organizationCredential
      || entryMeta?.organization_credential
      || entryResource?.organizationCredential
      || entryResource?.organization_credential;
    const legacyRepresentativeCredential =
      body?.representativeCredential
      || body?.representative_credential
      || body?.legalRepresentativeCredential
      || entryMeta?.representativeCredential
      || entryMeta?.representative_credential
      || entryMeta?.legalRepresentativeCredential
      || entryResource?.representativeCredential
      || entryResource?.representative_credential
      || entryResource?.legalRepresentativeCredential;
    const organizationCredential =
      legacyOrganizationCredential
      || this.extractCredentialFromVpToken(vpToken, ['OrganizationCredential', 'LegalOrganizationCredential']);
    const representativeCredential =
      legacyRepresentativeCredential
      || this.extractCredentialFromVpToken(vpToken, ['LegalRepresentativeCredential', 'PersonCredential']);
    const primaryDid =
      entryResource?.didDocument?.id
      || entryResource?.organizationDid
      || entryResource?.organization_did
      || entryMeta?.organizationDid
      || entryMeta?.organization_did
      || this.extractDidFromCredential(organizationCredential);

    return {
      vpToken,
      presentationSubmission:
        body?.presentation_submission
        || entryMeta?.presentation_submission
        || entryResource?.presentation_submission,
      organizationCredential,
      representativeCredential,
      legacyOrganizationCredential,
      legacyRepresentativeCredential,
      primaryDid,
      publicTenantUrl:
        entryResource?.organizationUrl
        || entryResource?.organization_url
        || entryMeta?.organizationUrl
        || entryMeta?.organization_url
        || (typeof primaryDid === 'string' && primaryDid.startsWith('did:web:')
          ? getBaseUrlFromDidWeb(primaryDid)
          : undefined),
      organizationBinding: this.extractActivationParticipantMaterial(
        body?.organization,
        entryMeta?.organization,
        entryResource?.organization,
        {
          did: entryResource?.organizationDid || entryResource?.organization_did || entryMeta?.organizationDid || entryMeta?.organization_did,
          publicKeyJwk:
            entryResource?.organizationPublicKeyJwk
            || entryMeta?.organizationPublicKeyJwk
            || body?.organizationPublicKeyJwk,
          jwks:
            entryResource?.organizationJwks
            || entryMeta?.organizationJwks
            || body?.organizationJwks,
        },
      ),
      controllerBinding: this.extractActivationParticipantMaterial(
        body?.controller,
        entryMeta?.controller,
        entryResource?.controller,
        {
          did:
            entryResource?.controllerDid
            || entryResource?.controller_did
            || entryMeta?.controllerDid
            || entryMeta?.controller_did
            || body?.controllerDid,
          sameAs:
            entryResource?.controllerSameAs
            || entryMeta?.controllerSameAs
            || body?.controllerSameAs,
          publicKeyJwk:
            entryResource?.controllerPublicKeyJwk
            || entryMeta?.controllerPublicKeyJwk
            || body?.controllerPublicKeyJwk,
          jwks:
            entryResource?.controllerJwks
            || entryMeta?.controllerJwks
            || body?.controllerJwks,
        },
      ),
    };
  }

  private extractActivationParticipantMaterial(...candidates: Array<any>): ActivationParticipantMaterial | undefined {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }
      const did = typeof candidate.did === 'string'
        ? candidate.did
        : typeof candidate.identifier === 'string'
          ? candidate.identifier
          : undefined;
      const sameAs = typeof candidate.sameAs === 'string' ? candidate.sameAs : undefined;
      const publicKeyJwk = candidate.publicKeyJwk && typeof candidate.publicKeyJwk === 'object'
        ? candidate.publicKeyJwk as PublicJwk
        : undefined;
      const jwks = Array.isArray(candidate.jwks?.keys)
        ? { keys: candidate.jwks.keys as any[] }
        : undefined;

      if (did || sameAs || publicKeyJwk || jwks) {
        return {
          ...(did ? { did } : {}),
          ...(sameAs ? { sameAs } : {}),
          ...(publicKeyJwk ? { publicKeyJwk } : {}),
          ...(jwks ? { jwks } : {}),
        };
      }
    }
    return undefined;
  }

  private warnOnLegacyActivationCredentialFields(activation: {
    legacyOrganizationCredential?: any;
    legacyRepresentativeCredential?: any;
  }): void {
    const usedLegacyFields = [
      activation.legacyOrganizationCredential ? 'organizationCredential' : undefined,
      activation.legacyRepresentativeCredential ? 'representativeCredential' : undefined,
    ].filter((value): value is string => Boolean(value));
    if (!usedLegacyFields.length) {
      return;
    }
    this.logger.warn?.(
      `[HostingManager] _activate received deprecated legacy compatibility field(s): ${usedLegacyFields.join(', ')}. `
      + 'Canonical proof must be carried in vp_token; controller.* is the explicit controller key-binding contract.',
    );
  }

  private isDemoSecurityMode(): boolean {
    return this.config.securityMode === 'demo' || String(this.config.nodeEnv || '').trim().toLowerCase() === 'demo';
  }

  private isDevelopmentOrDemoDiagnosticsEnabled(): boolean {
    const nodeEnv = String(this.config.nodeEnv || '').trim().toLowerCase();
    return this.isDemoSecurityMode() || nodeEnv === 'development';
  }

  private backfillOrganizationActivationRouteDefaults(
    claims: ClaimsRecord,
    routeJurisdiction?: string,
  ): ClaimsRecord {
    const processedClaims = { ...claims };
    const currentCountry = String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim();
    const fallbackCountry = String(routeJurisdiction || '').trim().toUpperCase();
    if (!currentCountry && fallbackCountry) {
      processedClaims[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
    }
    return processedClaims;
  }

  private logActivationIdentityDiagnostics(
    stage: string,
    claims: ClaimsRecord,
    routeJurisdiction?: string,
  ): void {
    if (!this.isDevelopmentOrDemoDiagnosticsEnabled()) return;
    console.log('[HostingManager] activation identity diagnostics', {
      stage,
      routeJurisdiction: String(routeJurisdiction || '').trim() || undefined,
      addressCountry: claims[ClaimsOrganizationSchemaorg.addressCountry],
      identifierType: claims[ClaimsOrganizationSchemaorg.identifierType],
      identifierValue: claims[ClaimsOrganizationSchemaorg.identifierValue],
      alternateName: claims[ClaimsOrganizationSchemaorg.alternateName],
      category: claims[ClaimsServiceSchemaorg.category],
      serviceType: claims[ClaimsServiceSchemaorg.serviceType],
    });
  }

  private assertActivationUrnInputs(claims: ClaimsRecord): void {
    const missing: string[] = [];
    if (!String(claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.addressCountry);
    }
    if (!String(claims[ClaimsOrganizationSchemaorg.identifierType] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.identifierType);
    }
    if (!String(claims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim()) {
      missing.push(ClaimsOrganizationSchemaorg.identifierValue);
    }
    if (missing.length > 0) {
      throw new ManagerError(
        `Missing required claim(s) for activation organization URN: ${missing.join(', ')}`,
        IssueType.Required,
      );
    }
  }

  private createOrganizationUrnSafely(
    claims: ClaimsRecord,
    requestedSector: Sector,
  ): string {
    this.assertActivationUrnInputs(claims);
    try {
      return createOrganizationUrn({
        namespace: this.config.namespace,
        network: this.getCurrentUrnNetwork(),
        jurisdiction: claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
        sector: requestedSector,
        idType: claims[ClaimsOrganizationSchemaorg.identifierType] as string,
        idValue: claims[ClaimsOrganizationSchemaorg.identifierValue] as string,
      });
    } catch (error: any) {
      throw new ManagerError(
        `Failed to construct activation organization URN: ${String(error?.message || error || 'unknown error')}`,
        IssueType.Required,
      );
    }
  }

  private extractRepresentativeCredentialBindingValue(representativeCredential: any): string | undefined {
    const credentialData = representativeCredential?.credentialSubject?.hasCredential;
    const candidates = Array.isArray(credentialData) ? credentialData : [credentialData];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === 'object') {
        const value = String(
          (candidate as any).material
          || (candidate as any).value
          || (candidate as any).identifier?.value
          || '',
        ).trim();
        if (value) {
          return value;
        }
      }
    }
    return undefined;
  }

  private async normalizeRepresentativeBindingMaterial(params: {
    publicKeyJwk?: PublicJwk;
    kid?: string;
  }): Promise<string | undefined> {
    if (params.publicKeyJwk) {
      try {
        return toJwkThumbprintSha256Urn(params.publicKeyJwk);
      } catch {
        // Fall through to kid normalization when the provided JWK cannot be
        // thumbprinted canonically.
      }
    }

    const rawKid = String(params.kid || '').trim();
    if (!rawKid) {
      return undefined;
    }
    if (rawKid.startsWith(JWK_THUMBPRINT_SHA256_URN_PREFIX)) {
      return rawKid;
    }
    return `${JWK_THUMBPRINT_SHA256_URN_PREFIX}${rawKid}`;
  }

  private async applyDemoRepresentativeBindingFallback(
    activation: ActivationMaterial,
    jobMeta?: DidCommDecodedMetadata,
  ): Promise<ActivationMaterial> {
    if (!this.isDemoSecurityMode() || !activation.representativeCredential) {
      return activation;
    }
    if (this.extractRepresentativeCredentialBindingValue(activation.representativeCredential)) {
      return activation;
    }

    const fallbackMaterial = await this.normalizeRepresentativeBindingMaterial({
      publicKeyJwk: activation.controllerBinding?.publicKeyJwk || jobMeta?.jws?.protected?.jwk as PublicJwk | undefined,
      kid: activation.controllerBinding?.publicKeyJwk?.kid || jobMeta?.jws?.protected?.kid,
    });
    if (!fallbackMaterial) {
      return activation;
    }

    this.logger.warn?.(
      '[HostingManager] _activate applied demo-only representative hasCredential.material fallback from controller/DIDComm metadata.',
    );

    return {
      ...activation,
      representativeCredential: {
        ...activation.representativeCredential,
        credentialSubject: {
          ...(activation.representativeCredential?.credentialSubject || {}),
          hasCredential: {
            material: fallbackMaterial,
          },
        },
      },
    };
  }

  private buildIcaSectorBaseUrl(jurisdiction: string, sector: string): string {
    const configuredBaseUrl = this.getIcaVerifyBaseUrl();
    const normalizedJurisdiction = this.resolveIcaJurisdiction(jurisdiction, configuredBaseUrl);
    const normalizedSector = String(sector || '').trim();
    if (!normalizedSector) {
      throw new ManagerError('ICA sector base URL requires a non-empty sector.', IssueType.Value);
    }
    if (configuredBaseUrl.includes('/ica/cds-')) {
      return configuredBaseUrl;
    }
    return `${configuredBaseUrl}/ica/cds-${normalizedJurisdiction}/v1/${normalizedSector}`;
  }

  private extractJurisdictionFromIcaDidWeb(value?: string): string | undefined {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return undefined;
    const match = normalizedValue.match(/:cds-([A-Za-z]{2,10})(?::|$)/i);
    const jurisdiction = match?.[1]?.trim();
    return jurisdiction ? jurisdiction.toUpperCase() : undefined;
  }

  private extractJurisdictionFromIcaUrl(value?: string): string | undefined {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return undefined;
    const match = normalizedValue.match(/\/ica\/cds-([A-Za-z]{2,10})\/v1(?:\/|$)/i);
    const jurisdiction = match?.[1]?.trim();
    return jurisdiction ? jurisdiction.toUpperCase() : undefined;
  }

  private resolveIcaJurisdiction(routeJurisdiction?: string, configuredBaseUrl?: string): string {
    const configuredJurisdiction = String(this.config.ica?.jurisdiction || '').trim().toUpperCase();
    if (configuredJurisdiction) {
      return configuredJurisdiction;
    }

    const didWebJurisdiction = this.extractJurisdictionFromIcaDidWeb(this.config.ica?.didWeb);
    if (didWebJurisdiction) {
      return didWebJurisdiction;
    }

    const baseUrlJurisdiction = this.extractJurisdictionFromIcaUrl(configuredBaseUrl || this.getIcaVerifyBaseUrl());
    if (baseUrlJurisdiction) {
      return baseUrlJurisdiction;
    }

    const normalizedRouteJurisdiction = String(routeJurisdiction || '').trim().toUpperCase();
    if (normalizedRouteJurisdiction && !this.isDemoSecurityMode()) {
      return normalizedRouteJurisdiction;
    }

    if (this.isDevelopmentOrDemoDiagnosticsEnabled()) {
      console.log('[HostingManager] ICA jurisdiction fallback', {
        routeJurisdiction: normalizedRouteJurisdiction || undefined,
        hostJurisdiction: String(this.config.host.jurisdiction || '').trim().toUpperCase() || undefined,
        configuredIcaDidWeb: this.config.ica?.didWeb,
        configuredIcaBaseUrl: configuredBaseUrl || this.getIcaVerifyBaseUrl(),
        resolvedIcaJurisdiction: undefined,
      });
    }

    throw new ManagerError(
      'ICA jurisdiction could not be resolved. Configure ICA_JURISDICTION, ICA_DID_WEB, or a path-scoped ICA URL such as /ica/cds-ES/v1/....',
      IssueType.Required,
    );
  }

  private buildIcaDidCreateUrl(jurisdiction: string, sector: string): string | undefined {
    const configuredBaseUrl = this.config.ica?.mode === 'internal'
      ? this.config.ica?.internalUrl
      : this.config.ica?.externalUrl || this.config.ica?.internalUrl;
    if (!configuredBaseUrl) {
      return undefined;
    }
    if (configuredBaseUrl.includes('/entity/did/document/_create')) {
      return configuredBaseUrl;
    }
    if (configuredBaseUrl.includes('/ica/cds-')) {
      return `${configuredBaseUrl.replace(/\/+$/, '')}/entity/did/document/_create`;
    }
    return `${this.buildIcaSectorBaseUrl(jurisdiction, sector)}/entity/did/document/_create`;
  }

  private resolveAbsoluteUrl(location: string, baseUrl?: string): string {
    const normalizedLocation = String(location || '').trim();
    if (!normalizedLocation) {
      throw new ManagerError('ICA polling location is empty.', IssueType.Value);
    }
    try {
      return new URL(normalizedLocation).toString();
    } catch {
      if (!baseUrl) {
        throw new ManagerError(`ICA polling location must be absolute or have a base URL: ${normalizedLocation}`, IssueType.Value);
      }
      return new URL(normalizedLocation, baseUrl).toString();
    }
  }

  private async pollIcaJsonResult(location: string, baseUrl?: string, attempts: number = 5): Promise<any | undefined> {
    const pollingUrl = this.resolveAbsoluteUrl(location, baseUrl);
    let waitMs = 2000;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const res = await fetch(pollingUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
      });
      const retryAfterRaw = res.headers.get('retry-after') || res.headers.get('Retry-After');
      const retryAfterSeconds = Number(retryAfterRaw);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        waitMs = retryAfterSeconds * 1000;
      }
      if (res.status === 202) {
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ManagerError(`ICA DID document poll failed: ${res.status} ${text}`.trim(), IssueType.Exception);
      }
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      if (
        !contentType.includes('application/json')
        && !contentType.includes('application/didcomm-plain+json')
        && !contentType.includes('application/didcomm-plaintext+json')
      ) {
        return undefined;
      }
      return await res.json().catch(() => undefined);
    }
    throw new ManagerError('ICA DID document creation polling timed out.', IssueType.NotSupported);
  }

  private async registerDidDocumentWithIca(params: {
    vpToken: string;
    presentationSubmission?: any;
    jurisdiction: string;
    sector: string;
    organizationCredential: any;
    representativeCredential: any;
    organizationDidDocument: DidDocument;
    controllerDidDocument: DidDocument;
    organizationBinding?: ActivationParticipantMaterial;
    controllerBinding?: ActivationParticipantMaterial;
  }): Promise<any | undefined> {
    const url = this.buildIcaDidCreateUrl(params.jurisdiction, params.sector);
    if (!url) {
      return undefined;
    }

    const organizationSigningKey = params.organizationDidDocument.verificationMethod?.find(
      (method) => (method.publicKeyJwk as any)?.use === 'sig' || (method.publicKeyJwk as any)?.alg,
    )?.publicKeyJwk;
    const controllerSigningKey = params.controllerDidDocument.verificationMethod?.find(
      (method) => (method.publicKeyJwk as any)?.use === 'sig' || (method.publicKeyJwk as any)?.alg,
    )?.publicKeyJwk;

    if (!organizationSigningKey || !controllerSigningKey) {
      throw new ManagerError('Could not resolve organization/controller signing keys for ICA DID registration.', IssueType.Exception);
    }
    if ((organizationSigningKey as any).kid && (organizationSigningKey as any).kid === (controllerSigningKey as any).kid) {
      throw new ManagerError('Organization and controller signing keys must be different for ICA DID registration.', IssueType.Conflict);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
        accept: DIDCOMM_DEFAULT_ACCEPT_HEADER,
      },
      body: JSON.stringify({
        thid: `ica-did-document-create-${Date.now()}`,
        type: DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
        body: {
          vp_token: params.vpToken,
          presentation_submission: params.presentationSubmission,
          data: [{
            resource: {
              organization: {
                credential: params.organizationCredential,
                identifier: params.organizationDidDocument.id,
                did: params.organizationDidDocument.id,
                didDocument: params.organizationDidDocument,
                publicKeyJwk: organizationSigningKey,
                ...(params.organizationBinding?.jwks ? { jwks: params.organizationBinding.jwks } : {}),
              },
              controller: {
                credential: params.representativeCredential,
                did: params.controllerDidDocument.id,
                didDocument: params.controllerDidDocument,
                publicKeyJwk: controllerSigningKey,
                ...(params.controllerBinding?.sameAs ? { sameAs: params.controllerBinding.sameAs } : {}),
                ...(params.controllerBinding?.jwks ? { jwks: params.controllerBinding.jwks } : {}),
              },
            },
          }],
        },
      }),
    });

    if (res.status === 202) {
      const location = res.headers.get('location') || res.headers.get('Location') || '';
      if (!location) {
        throw new ManagerError('ICA DID document creation returned 202 Accepted without Location header.', IssueType.NotSupported);
      }
      return await this.pollIcaJsonResult(location, url);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ManagerError(`ICA DID document creation failed: ${res.status} ${text}`.trim(), IssueType.Exception);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return undefined;
    }
    return await res.json().catch(() => undefined);
  }

  private normalizeBindingAliasList(value: unknown): string[] {
    const rawItems = Array.isArray(value) ? value : [value];
    const aliases = rawItems
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
      .map((item) => this.normalizeTenantPublicUrl(item) || item);
    return Array.from(new Set(aliases));
  }

  private extractRegistrationKeys(jobMeta?: DidCommDecodedMetadata) {
    const signerKid = jobMeta?.jws?.protected?.kid as string | undefined;
    const signerAlg = jobMeta?.jws?.protected?.alg as string | undefined;
    const signerJwkThumbprintMaterial = jobMeta?.jws?.protected?.jwk as PublicJwk | undefined;
    const signerJwk: PublicJwk | undefined =
      signerJwkThumbprintMaterial && signerKid
        ? ({ ...signerJwkThumbprintMaterial, kid: signerKid, use: 'sig', ...(signerAlg ? { alg: signerAlg } : {}) } as any)
        : undefined;

    const encrypterKid = (jobMeta?.jwe?.header as any)?.skid as string | undefined;
    const encrypterJwkThumbprintMaterial = jobMeta?.jwe?.header?.jwk as PublicJwk | undefined;
    const encrypterJwk: PublicJwk | undefined =
      encrypterJwkThumbprintMaterial && encrypterKid
        ? ({ ...encrypterJwkThumbprintMaterial, kid: encrypterKid, use: 'enc' } as any)
        : undefined;

    return { signerJwk, encrypterJwk };
  }

  private findJwkByUse(jwks: JwkSet | undefined, use: 'sig' | 'enc'): PublicJwk | undefined {
    if (!jwks?.keys?.length) {
      return undefined;
    }
    return jwks.keys.find((key: any) => use === 'sig' ? this.isSignatureJwk(key) : this.isEncryptionJwk(key)) as PublicJwk | undefined;
  }

  private isSignatureJwk(key: any): boolean {
    if (!key || typeof key !== 'object') {
      return false;
    }
    const purposes = Array.isArray(key.purposes) ? key.purposes : [];
    return key.use === 'sig'
      || purposes.includes('vc-sign')
      || purposes.includes('didcomm-sign')
      || (Array.isArray(key.key_ops) && key.key_ops.includes('verify'))
      || (typeof key.alg === 'string' && (key.alg.startsWith('ML-DSA') || key.alg.startsWith('ES') || key.alg.startsWith('RS') || key.alg.startsWith('PS')));
  }

  private isEncryptionJwk(key: any): boolean {
    if (!key || typeof key !== 'object') {
      return false;
    }
    const purposes = Array.isArray(key.purposes) ? key.purposes : [];
    return key.use === 'enc'
      || purposes.includes('didcomm-enc')
      || (Array.isArray(key.key_ops) && key.key_ops.includes('encrypt'))
      || (typeof key.crv === 'string' && (key.crv.startsWith('ML-KEM') || key.crv.startsWith('P-')));
  }

  private mergeActivationJwks(keys: Array<PublicJwk | undefined>, jwks?: JwkSet): JwkSet {
    const merged = new Map<string, PublicJwk>();
    const extraKeys = (jwks?.keys || []) as PublicJwk[];
    for (const key of [...keys, ...extraKeys]) {
      if (!key || typeof key !== 'object') {
        continue;
      }
      const kid = typeof key.kid === 'string' && key.kid.trim().length > 0
        ? key.kid
        : undefined;
      if (!kid) {
        throw new ManagerError('Activation public keys must include "kid" properties.', IssueType.Required);
      }
      merged.set(kid, key);
    }
    return { keys: Array.from(merged.values()) as any[] };
  }

  private async buildControllerEntityConfig(
    legalRep: IncludedResource,
    tenantUrn: string,
    vaultId: string,
    registrationKeys?: { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk },
    explicitBinding?: ActivationParticipantMaterial,
  ): Promise<EntityConfig> {
    const email = normalizeIndexedEmail(legalRep.meta?.claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
    const roleCode = getPersonOccupationClaim(legalRep.meta?.claims as Record<string, any> | undefined);
    if (!email || !roleCode) {
      throw new ManagerError('Missing required admin Person claims (email, hasOccupation).', IssueType.Required);
    }

    const parsedTenantUrn = parseTenantUrn(tenantUrn);
    if (!parsedTenantUrn) {
      throw new ManagerError(`Invalid tenant URN format: '${tenantUrn}'`, IssueType.Value);
    }
    const employeeUrn = createEmployeeUrn({
      namespace: parsedTenantUrn.namespace,
      network: parsedTenantUrn.network,
      jurisdiction: parsedTenantUrn.jurisdiction,
      version: parsedTenantUrn.version,
      sector: parsedTenantUrn.sector,
      idType: parsedTenantUrn.idType,
      idValue: parsedTenantUrn.idValue,
      email,
      role: roleCode,
    });

    let signerJwk = explicitBinding?.publicKeyJwk || this.findJwkByUse(explicitBinding?.jwks, 'sig') || registrationKeys?.signerJwk;
    let encrypterJwk = this.findJwkByUse(explicitBinding?.jwks, 'enc') || registrationKeys?.encrypterJwk;
    if (!signerJwk || !encrypterJwk) {
      const provisioned = await this.kmsService.provisionKeys(employeeUrn);
      signerJwk = signerJwk || provisioned.keys.find(k => (k as any).kty === 'AKP') as PublicJwk | undefined;
      encrypterJwk = encrypterJwk || provisioned.keys.find(k => (k as any).kty === 'OKP') as PublicJwk | undefined;
    }
    if (!signerJwk?.kid || !encrypterJwk?.kid) {
      throw new ManagerError('Admin keys are missing "kid" properties.', IssueType.Required);
    }
    const didId = explicitBinding?.did || employeeUrn;
    const alsoKnownAs = Array.from(new Set([
      didId !== employeeUrn ? employeeUrn : undefined,
      explicitBinding?.sameAs,
    ].filter((value): value is string => Boolean(value))));

    const mergedJwks = this.mergeActivationJwks([signerJwk, encrypterJwk], explicitBinding?.jwks);
    const didDocument = didId.startsWith('did:web:')
      ? populateDidDocumentFromJwks(
        {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: didId,
          ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
          service: [],
        },
        mergedJwks,
      )
      : (() => {
        const verificationMethod: VerificationMethod[] = [];
        const assertionMethod: string[] = [];
        const keyAgreement: string[] = [];
        for (const key of mergedJwks.keys as PublicJwk[]) {
          const keyId = `${didId}#${key.kid}`;
          verificationMethod.push({
            id: keyId,
            controller: didId,
            type: 'JsonWebKey2020',
            publicKeyJwk: key,
          });
          if (this.isSignatureJwk(key)) {
            assertionMethod.push(keyId);
          }
          if (this.isEncryptionJwk(key)) {
            keyAgreement.push(keyId);
          }
        }
        return {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: didId,
          ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
          verificationMethod,
          assertionMethod,
          keyAgreement,
          service: [],
        } as DidDocument;
      })();
    const verificationMethods = didDocument.verificationMethod || [];
    const signerMethodId = verificationMethods.find((method) => (method.publicKeyJwk as any)?.kid === signerJwk?.kid)?.id;

    return {
      id: legalRep.id,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims: legalRep.meta?.claims || {},
      didDocument: {
        ...didDocument,
        authentication: signerMethodId ? [signerMethodId] : didDocument.authentication,
      },
      didConfig: { service: [] },
      meta: { lastUpdated: new Date().toISOString() },
    };
  }

  /**
   * Persists the synthetic bootstrap controller employee created for hosted
   * tenant initialization.
   *
   * Important behavior:
   * - this employee is not treated as a normal descendant for lifecycle gates
   * - a lightweight technical marker is copied to `doc.public.role`
   * - `HostingLifecycleService` uses that marker to ignore this record when it
   *   counts remaining employees before tenant `disable`/`purge`
   *
   * This keeps lifecycle scans on the lightweight container projection and
   * avoids hydrating the encrypted JWE just to recognize the bootstrap record.
   */
  private async storeControllerEntityConfig(
    controllerConfig: EntityConfig,
    tenantCollectionName: string,
    vaultId: string,
  ): Promise<void> {
    const verificationMethods = controllerConfig.didDocument?.verificationMethod || [];
    const email = normalizeIndexedEmail(controllerConfig.claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
    const roleCode = getPersonOccupationClaim(controllerConfig.claims as Record<string, any> | undefined);

    const attributesToIndex: ParameterData[] = [
      ...(email ? [{ name: 'email', value: email, unique: true, type: 'string' } as ParameterData] : []),
      ...(roleCode ? [{ name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' } as ParameterData] : []),
      { name: 'lifecycleRole', value: HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE, unique: false, type: 'string' } as ParameterData,
      ...verificationMethods
        .map((vm) => (vm.publicKeyJwk as PublicJwk | undefined)?.kid)
        .filter((kid): kid is string => Boolean(kid))
        .map((kid) => ({ name: 'kid', value: kid, unique: false, type: 'string' } as ParameterData)),
    ];
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, vaultId);

    const employeeDoc = {
      id: controllerConfig.id,
      status: controllerConfig.status,
      sequence: 0,
      content: controllerConfig,
      indexed: { attributes: protectedAttributes },
      public: {
        // Lightweight runtime projection used only so lifecycle scans can
        // recognize and ignore the synthetic bootstrap controller employee.
        role: HOST_BOOTSTRAP_CONTROLLER_LIFECYCLE_ROLE,
      },
    } as ConfidentialStorageDoc;
    const secureEmployeeDoc = await this.kmsService.protectConfidentialData(employeeDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureEmployeeDoc], getEnvSectionId('employees'));
  }

  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    
    try {
      switch (job.resourceType) {
        case 'Organization':
          if (job.action === '_transaction') {
            return await this.processOrganizationVerificationTransaction(job);
          }
          if (job.action === '_issue') {
            return await this.processOrganizationIssue(job);
          }
          if (job.action === '_activate') {
            return await this.processOrganizationActivation(job, environment);
          }
          if (job.action === ACTION_DISABLE || job.action === ACTION_ENABLE || job.action === ACTION_PURGE) {
            return await this.processOrganizationLifecycle(job);
          }
          return await this.processOrganizationRegistration(job, environment, isBootstrap);
        case 'Document':
          if (job.section === 'did' && job.format === 'document' && job.action === '_binding') {
            return await this.processTenantDidDocumentBinding(job);
          }
          throw new ManagerError(`Unsupported action for Document: '${job.action}'`, IssueType.NotSupported);
        case 'Offer':
          if (job.action === '_search') {
            return await this.processOfferOrderSearch(job);
          }
          throw new ManagerError(`Unsupported action for Offer: '${job.action}'`, IssueType.NotSupported);
        case 'Order':
          if (job.action === '_search') {
            return await this.processOfferOrderSearch(job);
          }
          return await this.processOrder(job, environment);
        default:
          throw new ManagerError(`Unsupported resourceType for hosting process: '${job.resourceType}'`, IssueType.NotSupported);
      }
    } catch (error) {
      const entry = (job.content?.body?.data && job.content.body.data[0]) ? job.content.body.data[0] : { type: job.resourceType || 'unknown' };
      const errorEntry = this.handleError(error, entry.type, entry.meta);
      return {
        jti: uuidv4(),
        type: 'hosting-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        body: {
          data: [errorEntry],
          resourceType: 'Bundle',
          type: 'batch-response',
          total: 1,
        },
      };
    }
  }

  private async processTenantDidDocumentBinding(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const entry = (job.content?.body?.data?.[0] || {}) as Record<string, any>;
    const resource = (entry.resource || {}) as Record<string, any>;
    const organization = (resource.organization || {}) as Record<string, any>;
    const aliases = this.normalizeBindingAliasList(organization.url);
    if (!aliases.length) {
      throw new ManagerError('Organization DID binding requires at least one organization.url value.', IssueType.Required);
    }

    const tenantSector = String(job.sector || '').trim() as Sector;
    const tenantRouteId = String(job.tenantId || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!tenantSector || !tenantRouteId || !jurisdiction) {
      throw new ManagerError('Tenant DID binding requires tenantId, jurisdiction, and sector in the route.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(tenantSector, tenantRouteId);
    const tenantConfig = await this.tenantsCacheManager.getTenant(tenantVaultId);
    if (!tenantConfig) {
      throw new ManagerError(`Tenant not found for DID binding: '${tenantVaultId}'.`, IssueType.NotFound);
    }

    const hostCollectionName = this.hostRuntime.hostCollectionName;
    if (hostCollectionName) {
      const tenantRegistrationDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
        hostCollectionName,
        tenantVaultId,
        getEnvSectionId('tenants'),
      );
      if (tenantRegistrationDoc?.content?.didDocument) {
        tenantRegistrationDoc.content.didDocument.alsoKnownAs = aliases;
        tenantRegistrationDoc.content.meta = {
          ...(tenantRegistrationDoc.content.meta || {}),
          lastUpdated: new Date().toISOString(),
        };
        const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
        await this.vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
        await this.tenantsCacheManager.refreshTenant(tenantVaultId);
      }
    }

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        data: [{
          type: OrganizationDidBindingEntryTypes.Response,
          resource: {
            resourceType: 'Document',
            didDocument: {
              ...(tenantConfig.didDocument || {}),
              alsoKnownAs: aliases,
            },
          },
          response: { status: '200' },
        }],
        resourceType: 'Bundle',
        type: 'batch-response',
        total: 1,
      },
    };
  }

  /**
   * Forwards the first host-side legal-organization onboarding transaction to
   * ICA `_verify`.
   *
   * Separation of concerns:
   * - GW/portal/BFF communication keys remain in `meta.jws` / `meta.jwe`
   * - controller business binding material remains in
   *   `body.data[].resource.controller.publicKeyJwk`
   * - optional organization credential-signing material remains in
   *   `body.data[].resource.organization.publicKeyJwk`
   * - `_activate` remains a legacy compatibility route for callers that
   *   already start from an ICA proof, but this `_transaction` flow does not
   *   require it as a follow-up step
   */
  private async processOrganizationVerificationTransaction(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const entry = (job.content?.body?.data?.[0] || {}) as LegalOrganizationVerificationTransactionEntry;
    const claims = normalizeContextualizedClaims(entry.meta?.claims || {});
    const resource = (entry.resource || {}) as LegalOrganizationVerificationTransactionResource;
    const requestedSector = String(claims[ClaimsServiceSchemaorg.category] || '').trim();
    const resourceType = String(resource.verification?.resourceType || 'contract').trim() || 'contract';
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }

    const icaResponse = await this.forwardOrganizationVerificationTransactionToIca({
      job,
      entry,
      claims,
      resource,
      requestedSector,
      resourceType,
    });
    const vc = this.extractCredentialResourcesFromIcaPayload(icaResponse);

    const processedClaims = await this.createPendingTenantRegistrationFromClaims({
      claims,
      environment: resourceType,
      jobMeta: job.content?.meta,
      fallbackAlternateName: job.tenantId,
    });

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      body: {
        resourceType: 'Bundle',
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
        data: [{
          type: ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE_TYPE,
          ...(vc.length > 0 ? { vc } : {}),
          meta: {
            claims: processedClaims,
          },
          resource: this.buildOrganizationVerificationTransactionResponseResource(icaResponse, processedClaims),
          response: {
            status: '200',
          },
        }],
      },
    };
  }

  private async processOrganizationIssue(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const entry = (job.content?.body?.data?.[0] || {}) as LegalOrganizationVerificationTransactionEntry;
    const claims = normalizeContextualizedClaims(entry.meta?.claims || {});
    const resource = (entry.resource || {}) as LegalOrganizationVerificationTransactionResource;
    const requestedSector = String(claims[ClaimsServiceSchemaorg.category] || '').trim();
    const resourceType = String(resource.verification?.resourceType || 'contract').trim() || 'contract';
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }

    const icaResponse = await this.forwardOrganizationVerificationTransactionToIca({
      job,
      entry,
      claims,
      resource,
      requestedSector,
      resourceType,
    });
    const vc = this.extractCredentialResourcesFromIcaPayload(icaResponse);

    const processedClaims = await this.createOrganizationIssueClaimsFromClaims({
      claims,
      environment: resourceType,
      fallbackAlternateName: job.tenantId,
      bearerPayload: (job.content as any)?.meta?.bearer?.jwt?.payload,
    });

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      body: {
        resourceType: 'Bundle',
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
        data: [{
          type: ORGANIZATION_ISSUE_RESPONSE_TYPE,
          ...(vc.length > 0 ? { vc } : {}),
          meta: {
            claims: processedClaims,
          },
          resource: this.buildOrganizationIssueResponseResource(icaResponse),
          response: {
            status: '200',
          },
        }],
      },
    };
  }

  /**
   * Projects the host `_transaction-response` contract into one explicit object
   * that portal/BFF callers can consume without reverse-engineering GW state.
   *
   * Why this shape exists:
   * - `icaResponse` preserves the verification VCs/Bundle returned by ICA
   * - `meta.claims` already carries the generated host-side commercial offer
   * - `resource.next` makes the next mandatory host action explicit so the
   *   caller can continue directly with `Order/_batch`
   *
   * Contract rule:
   * - `_transaction` is the canonical legal-organization onboarding step
   * - `_activate` remains a legacy compatibility route, not a required
   *   continuation after `_transaction`
   * - the response prepares the host-side pending registration/offer state
   *   later consumed by Order
   */
  private buildOrganizationVerificationTransactionResponseResource(
    icaResponse: unknown,
    processedClaims: ClaimsRecord,
  ): LegalOrganizationVerificationTransactionResponseResource {
    const offerId = String(processedClaims[ClaimsOfferSchemaorg.identifier] || '').trim() || undefined;
    return {
      icaResponse,
      next: {
        action: ORGANIZATION_VERIFICATION_TRANSACTION_NEXT_ACTION,
        acceptedOffer: {
          ...(offerId ? { identifier: offerId } : {}),
          identifierClaim: ClaimsOrderSchemaorg.acceptedOfferIdentifier,
        },
      },
    };
  }

  private buildOrganizationIssueResponseResource(
    icaResponse: unknown,
  ): LegalOrganizationIssueResponseResource {
    return {
      icaResponse,
    };
  }

  /**
   * Creates the same provisional host-side registration state used by the
   * legacy registration offer flow, but starting from the claims already
   * validated for host `_transaction`.
   *
   * Step by step:
   * 1. normalize legal-organization identity compatibility fields
   * 2. ensure a tenant alternateName exists, falling back to the tenant route id
   * 3. validate the requested tenant sector against host policy
   * 4. derive the canonical organization identifier and commercial offer claims
   * 5. persist one `pending` host-side registration record indexed by offer id
   *
   * This helper is intentionally reused by both:
   * - direct organization registration (`Organization/_batch`)
   * - host legal verification transaction (`Organization/_transaction`)
   *
   * so the canonical flow can continue with `Order/_batch` without legacy `_activate`.
   */
  private async createPendingTenantRegistrationFromClaims(input: {
    claims: ClaimsRecord;
    environment?: string;
    jobMeta?: DidCommDecodedMetadata;
    fallbackAlternateName?: string;
  }): Promise<ClaimsRecord> {
    const normalizedClaims = this.applyLegalOrganizationIdentityCompatibility(input.claims);
    const alternateName = String(
      normalizedClaims[ClaimsOrganizationSchemaorg.alternateName]
      || input.fallbackAlternateName
      || '',
    ).trim();
    const enrichedClaims: ClaimsRecord = {
      ...normalizedClaims,
      ...(alternateName ? { [ClaimsOrganizationSchemaorg.alternateName]: alternateName } : {}),
    };

    if (!alternateName) {
      throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
    }
    if (!isValidTenantAlternateName(alternateName)) {
      throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
    }

    const requestedSector = enrichedClaims[ClaimsServiceSchemaorg.category] as Sector;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim for new tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }
    if (requestedSector === Sector.SYSTEM) {
      throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
    }
    if (!this.config.sectorsAllowed.includes(requestedSector)) {
      throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
    }

    const vaultId = getTenantVaultId(requestedSector, alternateName);
    if (await this.vaultRepository.vaultExists(vaultId)) {
      throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
    }

    const { organization, person, service } = this.extractResources(enrichedClaims, input.environment);
    const processedService = await this._handleServiceAttachment(service);
    let processedClaims: ClaimsRecord = { ...enrichedClaims, ...(processedService?.meta.claims || {}) };

    const jurisdiction = processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string;
    const isIndividualOrg = !!processedClaims['org.schema.Organization.owner.telephone'];
    if (!isIndividualOrg) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = createOrganizationUrn({
        namespace: this.config.namespace,
        network: this.getCurrentUrnNetwork(),
        jurisdiction,
        sector: requestedSector,
        idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
        idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
      });
    } else {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = alternateName || organization.id;
    }

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const offerClaims = generateLicenseOffer(
      processedClaims[ClaimsOrganizationSchemaorg.numberOfEmployees] as number,
      hostDid,
      jurisdiction,
      requestedSector,
      this.config.allowedPaymentMethods,
    );
    processedClaims = { ...processedClaims, ...offerClaims };

    const registrationKeys = this.extractRegistrationKeys(input.jobMeta);
    const tenantRegistrationDoc: ConfidentialStorageDoc = {
      id: vaultId,
      status: EntityLifecycleStatus.Pending,
      sequence: 0,
      indexed: {
        attributes: [
          { name: 'status', value: EntityLifecycleStatus.Pending },
          { name: ClaimsOfferSchemaorg.identifier, value: processedClaims[ClaimsOfferSchemaorg.identifier] as string, unique: true },
        ],
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: {
        status: EntityLifecycleStatus.Pending,
        claims: processedClaims,
        contained: [person, processedService].filter(Boolean),
        ...(registrationKeys.signerJwk || registrationKeys.encrypterJwk ? { registrationKeys } : {}),
      },
    };

    const hostCollectionName = this.hostRuntime.hostCollectionName;
    const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
    return processedClaims;
  }

  private async createOrganizationIssueClaimsFromClaims(input: {
    claims: ClaimsRecord;
    environment?: string;
    fallbackAlternateName?: string;
    bearerPayload?: Record<string, any>;
  }): Promise<ClaimsRecord> {
    const normalizedClaims = this.applyLegalOrganizationIdentityCompatibility(input.claims);
    const alternateName = String(
      normalizedClaims[ClaimsOrganizationSchemaorg.alternateName]
      || input.fallbackAlternateName
      || '',
    ).trim();
    const enrichedClaims: ClaimsRecord = {
      ...normalizedClaims,
      ...(alternateName ? { [ClaimsOrganizationSchemaorg.alternateName]: alternateName } : {}),
    };
    validateNewOrganizationClaims(enrichedClaims);

    if (!alternateName) {
      throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
    }
    if (!isValidTenantAlternateName(alternateName)) {
      throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
    }

    const requestedSector = enrichedClaims[ClaimsServiceSchemaorg.category] as Sector;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim for existing tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }
    if (requestedSector === Sector.SYSTEM) {
      throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
    }
    if (!this.config.sectorsAllowed.includes(requestedSector)) {
      throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
    }

    const vaultId = getTenantVaultId(requestedSector, alternateName);
    if (!await this.vaultRepository.vaultExists(vaultId)) {
      throw new ManagerError(`Tenant not found for Organization/_issue: '${vaultId}'`, IssueType.NotFound);
    }

    const controllerIdentity = await this.resolveOrganizationIssueControllerIdentity({
      claims: enrichedClaims,
      bearerPayload: input.bearerPayload,
      tenantVaultId: vaultId,
    });
    const claimsForValidation: ClaimsRecord = {
      ...enrichedClaims,
      ...(controllerIdentity.email && !enrichedClaims[ClaimsPersonSchemaorg.email]
        ? { [ClaimsPersonSchemaorg.email]: controllerIdentity.email }
        : {}),
      ...(controllerIdentity.role && !getPersonOccupationClaim(enrichedClaims as Record<string, any> | undefined)
        ? { [ClaimsPersonSchemaorg.hasOccupation]: controllerIdentity.role }
        : {}),
    };
    validateNewOrganizationClaims(claimsForValidation);

    const { organization, service } = this.extractResources(claimsForValidation, input.environment);
    const processedService = await this._handleServiceAttachment(service);
    let processedClaims: ClaimsRecord = { ...claimsForValidation, ...(processedService?.meta.claims || {}) };

    const jurisdiction = processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string;
    const isIndividualOrg = !!processedClaims['org.schema.Organization.owner.telephone'];
    if (!processedClaims[ClaimsOrganizationSchemaorg.identifier]) {
      if (!isIndividualOrg) {
        (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = createOrganizationUrn({
          namespace: this.config.namespace,
          network: this.getCurrentUrnNetwork(),
          jurisdiction,
          sector: requestedSector,
          idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
          idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
        });
      } else {
        (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = alternateName || organization.id;
      }
    }

    const { email: legalRepEmail, role: legalRepRole } = await this.resolveOrganizationIssueControllerIdentity({
      claims: processedClaims,
      bearerPayload: input.bearerPayload,
      tenantVaultId: vaultId,
    });
    if (!legalRepEmail) {
      throw new ManagerError(`Missing required claim for Organization/_issue: '${ClaimsPersonSchemaorg.email}'`, IssueType.Required);
    }
    if (!legalRepRole) {
      throw new ManagerError('Missing required controller occupation claim for Organization/_issue.', IssueType.Required);
    }

    try {
      const { activationCode } = await issueActivationCodeFromPool({
        vaultRepository: this.vaultRepository,
        kmsService: this.kmsService,
        tenantVaultId: vaultId,
        userClass: 'employee',
        type: 'mobile',
        email: legalRepEmail,
        role: legalRepRole,
      });
      (processedClaims as any)['org.schema.IndividualProduct.serialNumber'] = activationCode;
      (processedClaims as any)['org.schema.IndividualProduct.category'] = 'professional';
    } catch (error: any) {
      throw new ManagerError(
        `Unable to issue a controller activation code for existing tenant '${vaultId}': ${String(error?.message || error)}`,
        IssueType.Conflict,
      );
    }

    return processedClaims;
  }

  private async resolveOrganizationIssueControllerIdentity(input: {
    claims: ClaimsRecord;
    bearerPayload?: Record<string, any>;
    tenantVaultId: string;
  }): Promise<{ email?: string; role?: string; }> {
    const emailFromPayload = normalizeIndexedEmail(input.claims[ClaimsPersonSchemaorg.email]) as string | undefined;
    const emailFromBearer = normalizeIndexedEmail(
      (input.bearerPayload?.email as string | undefined)
      || (input.bearerPayload?.upn as string | undefined)
      || (input.bearerPayload?.preferred_username as string | undefined),
    ) as string | undefined;
    const roleFromPayload = getPersonOccupationClaim(input.claims as Record<string, any> | undefined);
    const isDemoMode = this.config.securityMode === 'demo';

    const email = isDemoMode
      ? (emailFromPayload || emailFromBearer)
      : emailFromBearer;
    let role = roleFromPayload || await this.findStoredControllerRoleByEmail(input.tenantVaultId, email);

    if (isDemoMode && !role) {
      role = 'ISCO-08|1120';
      console.log('[GW][demo] Organization/_issue controller role fallback applied', {
        tenantVaultId: input.tenantVaultId,
        email,
        role,
      });
    }
    if (isDemoMode) {
      console.log('[GW][demo] Organization/_issue controller identity resolved', {
        tenantVaultId: input.tenantVaultId,
        email,
        role,
        usedBearerEmail: email === emailFromBearer && !!emailFromBearer,
        usedPayloadEmail: email === emailFromPayload && !!emailFromPayload,
      });
    }
    return { email, role };
  }

  private async findStoredControllerRoleByEmail(
    tenantVaultId: string,
    email: string | undefined,
  ): Promise<string | undefined> {
    const normalizedEmail = normalizeIndexedEmail(email) as string | undefined;
    if (!normalizedEmail) return undefined;

    const employeeDocs = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      tenantVaultId,
      getEnvSectionId('employees'),
    );
    for (const employeeDoc of employeeDocs) {
      let claims = (employeeDoc?.content as any)?.claims as Record<string, any> | undefined;
      if (!claims && typeof (this.kmsService as any)?.unprotectConfidentialData === 'function') {
        try {
          const unprotected = await (this.kmsService as any).unprotectConfidentialData(employeeDoc, tenantVaultId);
          claims = unprotected?.claims as Record<string, any> | undefined;
        } catch {
          claims = claims || undefined;
        }
      }
      const storedEmail = normalizeIndexedEmail(claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
      if (!storedEmail || storedEmail !== normalizedEmail) {
        continue;
      }
      const storedRole = getPersonOccupationClaim(claims);
      if (storedRole) {
        return storedRole;
      }
    }
    return undefined;
  }

  private getIcaVerifyBaseUrl(): string {
    const configuredBaseUrl = this.config.ica?.mode === 'internal'
      ? this.config.ica?.internalUrl
      : this.config.ica?.externalUrl || this.config.ica?.internalUrl;
    if (!configuredBaseUrl) {
      throw new ManagerError('ICA verification URL is not configured.', IssueType.NotSupported);
    }
    return configuredBaseUrl.replace(/\/+$/, '');
  }

  private buildIcaVerifyUrl(jurisdiction: string, sector: string, resourceType: string): string {
    const normalizedResourceType = String(resourceType || 'contract').trim();
    return `${this.buildIcaSectorBaseUrl(jurisdiction, sector)}/terms/pdf/${normalizedResourceType}/_verify`;
  }

  private async forwardOrganizationVerificationTransactionToIca(input: {
    job: JobRequest;
    entry: LegalOrganizationVerificationTransactionEntry;
    claims: ClaimsRecord;
    resource: LegalOrganizationVerificationTransactionResource;
    requestedSector: string;
    resourceType: string;
  }): Promise<any> {
    const didcommContent = (input.job.content || {}) as IDecodedDidcommPayload & { attachments?: unknown[] };
    const attachments = Array.isArray(didcommContent.attachments) && didcommContent.attachments.length > 0
      ? didcommContent.attachments
      : Array.isArray((input.job.content?.body as any)?.attachments)
        ? (input.job.content?.body as any).attachments
        : [];
    const translatedBody = {
      resourceType: 'Bundle',
      type: 'collection',
      total: 1,
      data: [{
        type: input.entry.type || ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST_TYPE,
        meta: {
          claims: input.claims,
        },
        resource: {
          ...(input.resource.controller ? { controller: input.resource.controller } : {}),
          ...(input.resource.organization ? { organization: input.resource.organization } : {}),
          ...(input.resource.legalRepresentativePayload
            ? { legalRepresentative: input.resource.legalRepresentativePayload }
            : input.resource.legalRepresentative
              ? { legalRepresentative: input.resource.legalRepresentative }
              : {}),
          verification: {
            resourceType: input.resourceType,
          },
        },
      }],
    };
    const requestPayload = {
      jti: String(input.job.content?.jti || uuidv4()),
      thid: String(input.job.content?.thid || uuidv4()),
      iss: input.job.content?.iss,
      aud: 'ica',
      type: input.job.content?.type || 'application/api+json',
      body: translatedBody,
      ...(attachments.length ? { attachments } : {}),
      ...(input.job.content?.meta ? { meta: input.job.content.meta } : {}),
    };

    const verifyUrl = this.buildIcaVerifyUrl(
      input.job.jurisdiction || this.config.host.jurisdiction || 'ES',
      input.requestedSector,
      input.resourceType,
    );
    const response = await fetch(
      verifyUrl,
      {
        method: 'POST',
        headers: {
          accept: DIDCOMM_DEFAULT_ACCEPT_HEADER,
          'content-type': ICA_DIDCOMM_PLAIN_JSON_MEDIA_TYPE,
        },
        body: JSON.stringify(requestPayload),
      },
    );

    if (response.status === 202) {
      const location = response.headers.get('location') || response.headers.get('Location') || '';
      if (!location) {
        throw new ManagerError('ICA verify returned 202 Accepted without Location header.', IssueType.NotSupported);
      }
      const polled = await this.pollIcaJsonResult(location, verifyUrl);
      return polled || {};
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ManagerError(`ICA verify failed: ${response.status} ${text}`.trim(), IssueType.Exception);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {};
    }
    return await response.json().catch(() => ({}));
  }

  /**
   * Extracts credential resources from the raw ICA verification envelope.
   *
   * Transitional response contract:
   * - `resource.icaResponse` keeps the full raw ICA payload for debugging
   * - `resource.vc[]` exposes only credential resources so callers can consume
   *   the verification outcome directly
   */
  private extractCredentialResourcesFromIcaPayload(icaResponse: unknown): Array<Record<string, unknown>> {
    const credentials: Array<Record<string, unknown>> = [];
    const visited = new WeakSet<object>();
    const fingerprints = new Set<string>();

    const addCredential = (candidate: Record<string, unknown>) => {
      const subject = Array.isArray(candidate.credentialSubject)
        ? candidate.credentialSubject[0]
        : candidate.credentialSubject;
      const typeTokens = Array.isArray(candidate.type)
        ? candidate.type.map((token) => String(token || '').trim()).filter(Boolean)
        : typeof candidate.type === 'string'
          ? [candidate.type.trim()]
          : [];
      const fingerprint = JSON.stringify({
        id: candidate.id || '',
        issuer: candidate.issuer || '',
        type: typeTokens,
        subjectId: typeof subject === 'object' && subject ? (subject as any).id || '' : '',
      });
      if (fingerprints.has(fingerprint)) {
        return;
      }
      fingerprints.add(fingerprint);
      credentials.push(candidate);
    };

    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (visited.has(node as object)) {
        return;
      }
      visited.add(node as object);
      if (this.isCredentialLikeObject(node)) {
        addCredential(node as Record<string, unknown>);
      }
      if (Array.isArray(node)) {
        node.forEach((entry) => walk(entry));
        return;
      }
      const candidate = node as Record<string, unknown>;
      if (Array.isArray(candidate.data)) {
        candidate.data.forEach((entry) => walk(entry));
      }
      if (candidate.body) {
        walk(candidate.body);
      }
      if (candidate.resource) {
        walk(candidate.resource);
      }
    };

    walk(icaResponse);
    return credentials;
  }

  private isCredentialLikeObject(candidate: unknown): candidate is Record<string, unknown> {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return false;
    }
    const credential = candidate as Record<string, unknown>;
    const subject = credential.credentialSubject;
    if (!subject || (typeof subject !== 'object' && !Array.isArray(subject))) {
      return false;
    }
    const typeTokens = Array.isArray(credential.type)
      ? credential.type.map((token) => String(token || '').trim()).filter(Boolean)
      : typeof credential.type === 'string'
        ? [credential.type.trim()]
        : [];
    return !!credential.issuer
      || typeTokens.includes('VerifiableCredential')
      || typeTokens.some((token) => /Credential$/i.test(token));
  }

  /**
   * Reads already-persisted Offer/Order records so portal/BFF code can build
   * list/detail screens without reading raw vault sections directly.
   */
  private async processOfferOrderSearch(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        responseEntries.push(
          job.resourceType === 'Offer'
            ? await this.processOfferSearchEntry(job, entry)
            : await this.processOrderSearchEntry(job, entry),
        );
      } catch (error) {
        responseEntries.push(this.handleError(error, entry?.type || `${job.resourceType}-search`, entry?.meta));
      }
    }

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        data: responseEntries,
        resourceType: 'Bundle',
        type: getBundleResponseTypeForAction(job.action),
        total: responseEntries.length,
      },
    };
  }

  private async processOfferSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry> {
    return this.offerOrderService.processOfferSearchEntry(job, entry);
  }

  private async processOrderSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry> {
    return this.offerOrderService.processOrderSearchEntry(job, entry);
  }

  /**
   * Handles activation of an organization backend/connector from ICA-issued proof.
   *
   * TODO(ica-activation):
   * Replace this placeholder with the real flow:
   * 1. Validate the controller-submitted vp_token / ICA proof.
   * 2. Verify organization + representative credentials issued by ICA.
   * 3. Verify that the submitted backend/conector DID document matches the ICA-issued organization DID.
   * 4. Activate/provision the tenant backend in the selected host network.
   *
   * TODO(ica-deactivation-v1):
   * Add the symmetric host/portal `/_deactivate` flow for ICA-backed lifecycle changes.
   * GW local `disable` means suspension only. Authoritative VC suspension/revocation
   * must come from ICA/ledger `credentialStatus`, and the corresponding update must
   * not purge historical tenant/controller/license evidence.
   */
  private async processOrganizationActivation(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const body = job?.content?.body as any;

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processActivationEntry(
          entry,
          body,
          environment,
          job.content?.meta,
          job.sector,
          job.jurisdiction,
        );
        responseEntries.push(resultEntry);
      } catch (error) {
        responseEntries.push(this.handleError(error, entry?.type || 'Organization', entry?.meta));
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processOrganizationLifecycle(job: JobRequest): Promise<IDecodedDidcommPayload> {
    return this.lifecycleService.processOrganizationLifecycle(job);
  }

  private async processActivationEntry(
    entry: BundleEntry,
    body: any,
    environment?: string,
    jobMeta?: DidCommDecodedMetadata,
    hostRegistrySector?: string,
    routeJurisdiction?: string,
  ): Promise<BundleEntry | ErrorEntry> {
    const activation = await this.applyDemoRepresentativeBindingFallback(
      this.extractActivationMaterial(entry, body),
      jobMeta,
    );
    this.warnOnLegacyActivationCredentialFields(activation);
    if (!activation.vpToken || typeof activation.vpToken !== 'string') {
      throw new ManagerError("Missing required activation proof 'vp_token'.", IssueType.Required);
    }
    const trustResult = await this.activationTrustAdapter.evaluate({
      networkMode: this.config.networkMode,
      vpToken: activation.vpToken,
      presentationSubmission: activation.presentationSubmission,
      primaryDid: activation.primaryDid,
      organizationCredential: activation.organizationCredential,
      representativeCredential: activation.representativeCredential,
      jurisdiction: body?.jurisdiction,
      sector: body?.sector,
    });
    const clearingResult = trustResult.clearingHouse;
    const { organizationDid } = trustResult;

    const rawClaims = entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed activation entry: missing meta.claims', IssueType.Required);
    }

    const normalizedClaims = this.backfillOrganizationActivationRouteDefaults(
      this.applyLegalOrganizationIdentityCompatibility(
        claims,
        activation.organizationCredential,
      ),
      routeJurisdiction,
    );
    this.logActivationIdentityDiagnostics('normalized-claims', normalizedClaims, routeJurisdiction);
    validateNewOrganizationClaims(normalizedClaims);
    const alternateName = normalizedClaims[ClaimsOrganizationSchemaorg.alternateName] as string;
    if (!alternateName) {
      throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
    }
    if (!isValidTenantAlternateName(alternateName)) {
      throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
    }

    const requestedSector = normalizedClaims[ClaimsServiceSchemaorg.category] as Sector;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim for activation: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }
    if (requestedSector === Sector.SYSTEM) {
      throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
    }
    if (!this.config.sectorsAllowed.includes(requestedSector)) {
      throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
    }
    const requestedServiceTypes = parseServiceCapabilityTokens(
      normalizedClaims[ClaimsServiceSchemaorg.serviceType],
    );
    const serviceAuthorizationErrors = validateActivationServiceAuthorizationPolicy({
      organizationCredential: activation.organizationCredential,
      requiredCategory: requestedSector,
      requiredServiceTypes: requestedServiceTypes,
    });
    if (serviceAuthorizationErrors.length > 0) {
      const first = serviceAuthorizationErrors[0];
      const issueType = first.code.startsWith('UNAUTHORIZED_')
        ? IssueType.Conflict
        : IssueType.Required;
      throw new ManagerError(first.message, issueType);
    }

    const vaultId = getTenantVaultId(requestedSector, alternateName);
    if (await this.vaultRepository.vaultExists(vaultId)) {
      throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
    }

    const { organization, person, service } = this.extractResources(normalizedClaims, environment);
    const processedService = await this._handleServiceAttachment(service);
    const processedClaims = this.backfillOrganizationActivationRouteDefaults(
      { ...normalizedClaims, ...(processedService?.meta.claims || {}) },
      routeJurisdiction,
    );
    this.logActivationIdentityDiagnostics('processed-claims', processedClaims, routeJurisdiction);
    const normalizedPublicUrl = this.normalizeTenantPublicUrl(
      activation.publicTenantUrl
      || (processedClaims[ClaimsOrganizationSchemaorg.url] as string | undefined),
    );
    if (normalizedPublicUrl) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.url] = normalizedPublicUrl;
    }
    if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      const fallbackCountry = String(this.config.host.jurisdiction || '').trim();
      if (fallbackCountry) {
        (processedClaims as any)[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
      }
    }
    if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      throw new ManagerError(`Missing required claim for activation: '${ClaimsOrganizationSchemaorg.addressCountry}'`, IssueType.Required);
    }
    if (!(processedClaims as any)[ClaimsOrganizationSchemaorg.identifier]) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = this.createOrganizationUrnSafely(
        processedClaims,
        requestedSector,
      );
    }
    const requestedEmployeeSeats = Number(processedClaims[ClaimsOrganizationSchemaorg.numberOfEmployees] || 0);
    if (Number.isFinite(requestedEmployeeSeats) && requestedEmployeeSeats > 0) {
      const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
      const offerClaims = generateLicenseOffer(
        requestedEmployeeSeats,
        hostDid,
        processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
        requestedSector,
        this.config.allowedPaymentMethods,
      );
      Object.assign(processedClaims, offerClaims);
    }

    const tenantCollectionName = generateTenantCollectionNameFromClaims(processedClaims);
    await this.vaultRepository.createNewVault({ id: tenantCollectionName });
    await this.kmsService.provisionKeys(vaultId);

    const finalTenantConfig = await this.finalizeTenantConfig(
      organization,
      alternateName,
      processedClaims,
      requestedSector,
      vaultId,
      {
        networkName: this.mapHostRegistrySectorToNetworkName(hostRegistrySector),
        primaryDid: organizationDid,
        publicTenantUrl: normalizedPublicUrl,
        governanceVc: activation.organizationCredential as VerifiableCredentialV2 | undefined,
      },
    );
    if (activation.representativeCredential || activation.vpToken) {
      finalTenantConfig.verifiablePresentation = {
        vp_token: activation.vpToken,
        presentation_submission: activation.presentationSubmission,
        representativeCredential: activation.representativeCredential,
        clearingHouse: clearingResult,
        trustPolicy: trustResult.trustPolicy,
      };
    }

    const attributes = AllowedIndexableClaims.organizationRegistry
      .map(claimKey => ({ name: claimKey, value: String(processedClaims[claimKey]), ...(claimKey === ClaimsOrganizationSchemaorg.alternateName && { unique: true }) }))
      .filter(attr => attr.value !== 'undefined' && attr.value !== 'null');

    const tenantRegistrationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: vaultId,
      status: finalTenantConfig.status,
      sequence: 0,
      meta: { claims: processedClaims },
      indexed: {
        attributes: [
          ...attributes,
          ...buildOfferOrderIndexedAttributes(processedClaims),
        ],
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: finalTenantConfig,
    };

    const hostCollectionName = this.hostRuntime.hostCollectionName;
    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }
    const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));

    const legalParticipantDoc: ConfidentialStorageDoc = { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
    const secureLegalParticipantDoc = await this.kmsService.protectConfidentialData(legalParticipantDoc, vaultId);
    const secureLegacyVcDoc = await this.kmsService.protectConfidentialData(legacyVcDoc, vaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc], getEnvSectionId('.well-known'));

    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: this.getCurrentUrnNetwork(),
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: requestedSector,
      idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    const controllerConfig = await this.buildControllerEntityConfig(
      person,
      tenantUrn,
      vaultId,
      this.extractRegistrationKeys(jobMeta),
      activation.controllerBinding,
    );
    await this.storeControllerEntityConfig(controllerConfig, tenantCollectionName, vaultId);
    const icaDidRegistration = await this.registerDidDocumentWithIca({
      vpToken: activation.vpToken,
      presentationSubmission: activation.presentationSubmission,
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: requestedSector,
      organizationCredential: activation.organizationCredential,
      representativeCredential: activation.representativeCredential,
      organizationDidDocument: finalTenantConfig.didDocument!,
      controllerDidDocument: controllerConfig.didDocument!,
      organizationBinding: activation.organizationBinding,
      controllerBinding: activation.controllerBinding,
    });

    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], getEnvSectionId('services'));
    }

    if (activation.representativeCredential || activation.vpToken || activation.organizationCredential) {
      const activationProofDoc: ConfidentialStorageDoc = {
        id: 'activation-proof.json',
        status: 'active',
        sequence: 0,
        content: {
          vp_token: activation.vpToken,
          presentation_submission: activation.presentationSubmission,
          clearingHouse: clearingResult,
          trustPolicy: trustResult.trustPolicy,
          organizationCredential: activation.organizationCredential,
          representativeCredential: activation.representativeCredential,
          icaDidRegistration,
        },
      };
      const secureActivationProofDoc = await this.kmsService.protectConfidentialData(activationProofDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureActivationProofDoc], getEnvSectionId('proofs'));
    }

    if (this.isLedgerRegistrationEnabled()) {
      const serviceEvidence = this.extractServiceEvidence(processedService);
      await registerOrganizationOnLedger({
        ledgerConfig: this.config.ledger,
        hostJurisdiction: this.config.host.jurisdiction,
        namespace: this.config.namespace,
        hostExternalDomain: this.config.hostExternalDomain,
        logger: this.logger,
        orgId: (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] || tenantUrn,
        organization,
        config: finalTenantConfig,
        evidence: serviceEvidence,
        role: 'tenant',
        sector: requestedSector,
        jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      });
    }

    return {
      type: 'Organization-activation-response-v1.0',
      meta: {
        claims: {
          ...processedClaims,
          'org.schema.Organization.did': finalTenantConfig.didDocument?.id,
          'org.schema.Action.clearingHouse.acr': clearingResult.acr,
          'org.schema.Action.clearingHouse.ledgerVerified': String(clearingResult.ledgerVerified),
          'org.schema.Action.activation.networkMode': trustResult.trustPolicy.networkMode,
          'org.schema.Action.activation.revocationChecked': String(trustResult.trustPolicy.revocationChecked),
          'org.schema.Action.activation.onChainChecked': String(trustResult.trustPolicy.onChainChecked),
        },
      },
      resource: {
        resourceType: 'Organization',
        id: organization.id,
      },
      response: { status: '201' },
    };
  }

  /**
   * Handles Phase 1, Step 1: Provisional Registration.
   */
  private async processOrganizationRegistration(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    if (job.section === SUBJECT_SECTION_INDIVIDUAL && (job.action === '_batch' || job.action === '_search')) {
      return this.processIndividualOrganizationFlow(job, environment);
    }

    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processRegistrationEntry(entry, environment, job.content?.meta);
        responseEntries.push(resultEntry);
      } catch (error) {
        if (isBootstrap) { throw error; }
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processIndividualOrganizationFlow(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        if (job.action === '_search') {
          responseEntries.push(await this.processIndividualOrganizationSearchEntry(job, entry));
        } else {
          responseEntries.push(await this.processIndividualOrganizationRegistrationEntry(job, entry, environment));
        }
      } catch (error) {
        responseEntries.push(this.handleError(error, entry.type, entry.meta));
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async resolveTenantCollectionForIndividuals(tenantVaultId: string, createIfMissing: boolean): Promise<string> {
    const cached = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (cached) return cached;

    if (createIfMissing) {
      const exists = await this.vaultRepository.vaultExists(tenantVaultId);
      if (!exists) {
        await this.vaultRepository.createNewVault({ id: tenantVaultId });
      }
    }
    return tenantVaultId;
  }

  private async processIndividualOrganizationRegistrationEntry(
    job: JobRequest,
    entry: BundleEntry,
    environment?: string,
  ): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const sector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!sector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }
    if (!job.tenantId) {
      throw new ManagerError('Job is missing tenantId.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector, job.tenantId);
    const tenantConfig = await this.tenantsCacheManager.getTenant(tenantVaultId);
    if (!tenantConfig) {
      throw new ManagerError(`Hosted tenant '${tenantVaultId}' was not found.`, IssueType.NotFound);
    }
    const tenantAuthorizationStatus = getTenantAuthorizationStatus(tenantConfig);
    if (tenantAuthorizationStatus !== 'active') {
      throw new ManagerError('Hosted individual registration is not allowed while the tenant is disabled.', IssueType.Forbidden);
    }
    const tenantCollectionName = await this.resolveTenantCollectionForIndividuals(tenantVaultId, true);

    const apodo = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    if (!apodo || (ownerPhones.length === 0 && ownerEmails.length === 0)) {
      throw new ManagerError(
        `Missing required claims: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    for (const phone of ownerPhones) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        where: [
          { name: 'org.schema.Organization.owner.telephone', value: phone },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
        ],
      });
      if (results.length > 0) {
        const existing = results[0] as ConfidentialStorageDoc;
        const content = await this.kmsService.unprotectConfidentialData<any>(existing, tenantVaultId);
        return {
          type: 'Family-registration-offer-v1.0',
          meta: { claims: { ...(content?.claims || {}), 'org.schema.FamilyRegistration.status': 'already_exists' } },
          resource: { resourceType: 'Organization', id: existing.id },
          response: { status: '200' },
        };
      }
    }
    for (const email of ownerEmails) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        where: [
          { name: 'org.schema.Organization.owner.email', value: email },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
        ],
      });
      if (results.length > 0) {
        const existing = results[0] as ConfidentialStorageDoc;
        const content = await this.kmsService.unprotectConfidentialData<any>(existing, tenantVaultId);
        return {
          type: 'Family-registration-offer-v1.0',
          meta: { claims: { ...(content?.claims || {}), 'org.schema.FamilyRegistration.status': 'already_exists' } },
          resource: { resourceType: 'Organization', id: existing.id },
          response: { status: '200' },
        };
      }
    }

    const { organization } = this.extractResources(claims, environment);
    const docId = String(claims[`${ClaimsOrganizationSchemaorg.identifierValue}`] || organization.id || uuidv4());
    const finalClaims = { ...claims, [ClaimsOrganizationSchemaorg.identifierValue]: docId };
    const indexedAttributes = [
      { name: 'status', value: EntityLifecycleStatus.Active },
      { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
      ...ownerPhones.map((phone) => ({ name: 'org.schema.Organization.owner.telephone', value: phone })),
      ...ownerEmails.map((email) => ({ name: 'org.schema.Organization.owner.email', value: email })),
    ];

    const registrationDoc: ConfidentialStorageDoc = {
      id: docId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      indexed: {
        attributes: indexedAttributes,
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: {
        status: EntityLifecycleStatus.Active,
        claims: finalClaims,
      },
    };
    const secureDoc = await this.kmsService.protectConfidentialData(registrationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureDoc], getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL));

    return {
      type: 'Family-registration-offer-v1.0',
      meta: { claims: { ...finalClaims, 'org.schema.FamilyRegistration.status': 'new_created' } },
      resource: { resourceType: 'Organization', id: docId },
      response: { status: '201' },
    };
  }

  private async processIndividualOrganizationSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const sector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!sector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }
    if (!job.tenantId) {
      throw new ManagerError('Job is missing tenantId.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector, job.tenantId);
    const tenantCollectionName = await this.resolveTenantCollectionForIndividuals(tenantVaultId, false);

    const apodo = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    if (!apodo || (ownerPhones.length === 0 && ownerEmails.length === 0)) {
      throw new ManagerError(
        `Missing required claims for search: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const whereByPhone = ownerPhones.map((phone) => [
      { name: 'org.schema.Organization.owner.telephone', value: phone },
      { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
    ]);
    const whereByEmail = ownerEmails.map((email) => [
      { name: 'org.schema.Organization.owner.email', value: email },
      { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
    ]);

    let found: ConfidentialStorageDoc | undefined;
    for (const where of [...whereByPhone, ...whereByEmail]) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        where,
      });
      if (results.length > 0) {
        found = results[0] as ConfidentialStorageDoc;
        break;
      }
    }

    if (!found) {
      return {
        type: 'Family-search-result-v1.0',
        meta: { claims: { 'org.schema.FamilyRegistration.status': 'not_found' } },
        response: { status: '200' },
      };
    }

    const content = await this.kmsService.unprotectConfidentialData<any>(found, tenantVaultId);
    return {
      type: 'Family-search-result-v1.0',
      meta: { claims: { ...(content?.claims || {}), 'org.schema.FamilyRegistration.status': 'already_exists' } },
      resource: { resourceType: 'Organization', id: found.id },
      response: { status: '200' },
    };
  }

  /**
   * Handles Phase 1, Step 2: Finalizing Registration via Order.
   */
  private async processOrder(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processOrderEntry(entry, environment);
        responseEntries.push(resultEntry);
      } catch (error) {
        const errorEntry = this.handleError(error, entry.type, entry.meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }
  
  /**
   * Processes an Order entry to finalize a tenant's registration.
   */
  private async processOrderEntry(entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed order entry: missing meta.claims', IssueType.Required);
    }

    const offerId = getClaimValue<string>(claims, 'Order.acceptedOffer.identifier');
    if (!offerId) {
      throw new ManagerError(`Missing required claim in Order: 'Order.acceptedOffer.identifier'`, IssueType.Required);
    }

    const hostCollectionName = this.hostRuntime.hostCollectionName;
    
    const query = {
      sectionId: getEnvSectionId('tenants'),
      where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
    };
    
    const results = await this.vaultRepository.query(hostCollectionName!, query);

    if (results.length === 0) {
      return this.offerOrderService.processLicenseOrderEntry(claims, offerId);
    }
    if (results.length > 1) {
      this.logger.error(`CRITICAL: Multiple pending registrations found for the same offerId: '${offerId}'`);
      throw new ManagerError(`Internal system conflict. Multiple pending registrations found.`, IssueType.Conflict);
    }

    const secureDoc = results[0] as ConfidentialStorageDoc;
    const decryptedContent = await this.kmsService.unprotectConfidentialData<ConfidentialStorageDoc['content']>(
      secureDoc,
      'host',
    );

    if (decryptedContent?.status !== EntityLifecycleStatus.Pending) {
      const projectedClaims = readProjectedOfferOrderClaims(secureDoc);
      if (
        decryptedContent?.status === EntityLifecycleStatus.Active
        && String(projectedClaims[ClaimsOfferSchemaorg.identifier] || '').trim() === offerId
      ) {
        return this.processActivatedTenantOrderEntry(claims, offerId, projectedClaims);
      }
      throw new ManagerError(`Found registration for offerId '${offerId}', but it is not in 'pending' state.`, IssueType.Conflict);
    }

    const { claims: processedClaims, contained } = decryptedContent as any;
    const alternateName = processedClaims[ClaimsOrganizationSchemaorg.alternateName] as string;
    const sector = processedClaims[ClaimsServiceSchemaorg.category] as Sector;
    // Ensure the canonical tenant identifier URN exists for downstream managers (e.g., EmployeeManager issuer).
    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: this.getCurrentUrnNetwork(),
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector,
      idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = tenantUrn;

    const { organization, person, service } = this.extractResources(processedClaims, environment);
    const containedService = this.extractContainedService(contained);

    // Finalize the registration and grant test network access.
    const vaultId = getTenantVaultId(sector, alternateName);
    const tenantCollectionName = generateTenantCollectionNameFromClaims(processedClaims);
    
    // Create the physical vault and keys for the new tenant.
    await this.vaultRepository.createNewVault({ id: tenantCollectionName });
    await this.kmsService.provisionKeys(vaultId);
    
    // Generate the final configuration.
    const finalTenantConfig = await this.finalizeTenantConfig(organization, alternateName, processedClaims, sector, vaultId);

    // Persist all artifacts
    const attributes = AllowedIndexableClaims.organizationRegistry
      .map(claimKey => ({ name: claimKey, value: String(processedClaims[claimKey]), ...(claimKey === ClaimsOrganizationSchemaorg.alternateName && { unique: true }) }))
      .filter(attr => attr.value !== 'undefined' && attr.value !== 'null');

    const finalTenantRegistrationDoc: ConfidentialStorageDoc = {
      id: vaultId,
      status: finalTenantConfig.status,
      sequence: 1, // Increment sequence for update
      indexed: { attributes, hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' } },
      content: finalTenantConfig,
    };
    
    const secureFinalDoc = await this.kmsService.protectConfidentialData(finalTenantRegistrationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName!, [secureFinalDoc], getEnvSectionId('tenants'));

    if (this.isLedgerRegistrationEnabled()) {
      const serviceEvidence = this.extractServiceEvidence(containedService || service);
      await registerOrganizationOnLedger({
        ledgerConfig: this.config.ledger,
        hostJurisdiction: this.config.host.jurisdiction,
        namespace: this.config.namespace,
        hostExternalDomain: this.config.hostExternalDomain,
        logger: this.logger,
        orgId: tenantUrn,
        organization,
        config: finalTenantConfig,
        evidence: serviceEvidence,
        role: 'tenant',
        sector,
        jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      });
    }
    
    // Save VCs and other resources into the TENANT's own vault
    const legalParticipantDoc: ConfidentialStorageDoc = { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
    const secureLegalParticipantDoc = await this.kmsService.protectConfidentialData(legalParticipantDoc, vaultId);
    const secureLegacyVcDoc = await this.kmsService.protectConfidentialData(legacyVcDoc, vaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc], getEnvSectionId('.well-known'));

    const [legalRep, processedService] = [person, service];
    if (legalRep) {
      const storedKeys = (decryptedContent as any)?.registrationKeys as
        | { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk }
        | undefined;
      const employeeConfig = await this.buildControllerEntityConfig(legalRep, tenantUrn, vaultId, storedKeys);
      await this.storeControllerEntityConfig(employeeConfig, tenantCollectionName, vaultId);
    }
	    if (processedService) {
	      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
	      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
	      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], getEnvSectionId('services'));
	    }
	    
	    // Create the initial employee device licenses purchased via the registration Offer.
	    const initialEmployeeSeats = processedClaims[ClaimsOfferSchemaorg.eligibleQuantityValue] as number | undefined;
	    const offerIdentifier = processedClaims[ClaimsOfferSchemaorg.identifier] as string | undefined;
	    if (initialEmployeeSeats && initialEmployeeSeats > 0 && offerIdentifier) {
	      const now = Date.now();
	      const expiryDate = new Date(now);
	      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
	      const exp = Math.floor(expiryDate.getTime() / 1000);
	
	      const licenseDocs: ConfidentialStorageDoc[] = [];
	      for (let i = 0; i < initialEmployeeSeats; i++) {
	        const licenseId = uuidv4();
	        const license: DeviceLicense = {
	          id: licenseId,
	          tenantId: alternateName,
	          orderId: offerIdentifier,
	          userClass: 'employee',
	          userCategory: 'default',
	          type: 'mobile',
	          status: 'available',
	          plan: 'default',
	          renewalCycle: '12m',
	          reactivationEnabled: false,
	          exp,
	        };
	        licenseDocs.push({ id: licenseId, status: license.status, sequence: 0, content: license });
	      }
	      await this.vaultRepository.put(vaultId, licenseDocs, getEnvSectionId('device-licenses'));

        // Auto-issue the first activation code for the legal representative so they can register their first device
        // right after accepting/paying the Order (no manual "invite" step needed for the first controller).
        const legalRepEmail = processedClaims[ClaimsPersonSchemaorg.email] as string | undefined;
        const legalRepRole = getPersonOccupationClaim(processedClaims as Record<string, any> | undefined);
        if (legalRepEmail && legalRepRole) {
          try {
            const { activationCode } = await issueActivationCodeFromPool({
              vaultRepository: this.vaultRepository,
              kmsService: this.kmsService,
              tenantVaultId: vaultId,
              userClass: 'employee',
              type: 'mobile',
              email: legalRepEmail,
              role: legalRepRole,
            });
            // The activation code is conceptually a "license key"/serial number for a newly issued seat.
            // Use schema.org-aligned claim names for the public API contract.
            (processedClaims as any)['org.schema.IndividualProduct.serialNumber'] = activationCode;
            // Disambiguate the seat class for integrators (employee/professional vs family/individual vs device).
            (processedClaims as any)['org.schema.IndividualProduct.category'] = 'professional';
          } catch (e: any) {
            this.logger.warn?.(
              `[HostingManager] Failed to auto-issue legal rep activation code: ${String(e?.message || e)}`,
            );
          }
        }
	    }

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const tenantDid = finalTenantConfig.didDocument?.id || tenantUrn;
    const paymentContext = {
      offerId,
      tenantId: alternateName,
      tenantDid,
      senderDid: hostDid,
      email: processedClaims[ClaimsPersonSchemaorg.email] as string | undefined,
      legalName: processedClaims[ClaimsOrganizationSchemaorg.legalName] as string | undefined,
      addressCountry: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined,
      addressRegion: processedClaims[ClaimsOrganizationSchemaorg.addressRegion] as string | undefined,
      addressLocality: processedClaims[ClaimsOrganizationSchemaorg.addressLocality] as string | undefined,
      postalCode: processedClaims[ClaimsOrganizationSchemaorg.postalCode] as string | undefined,
      streetAddress: processedClaims[ClaimsOrganizationSchemaorg.streetAddress] as string | undefined,
      activationCode: (processedClaims as any)['org.schema.IndividualProduct.serialNumber'] as string | undefined,
      activationCategory: (processedClaims as any)['org.schema.IndividualProduct.category'] as string | undefined,
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
      invoiceId: claims[ClaimsOrderSchemaorg.partOfInvoice] as string | undefined,
      paymentConfirmed: true,
      ...readOfferPaymentContext(processedClaims),
    };
    const paymentCommunication = await buildPaymentCommunication(paymentContext);
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || paymentCommunication.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]
        || offerId,
      ),
      subjectReference: tenantDid || tenantUrn,
      issuerReference: hostDid,
      recipientReference: tenantDid || tenantUrn,
      issuedAt: String(
        paymentCommunication.claims['org.schema.Order.invoiceIssuedAt']
        || new Date().toISOString(),
      ),
      amount: String(processedClaims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(processedClaims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
    });

    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }
    const communicationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims: paymentCommunication.claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(paymentCommunication.claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: paymentCommunication.claims, invoiceBundle },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Organization-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
      resource: invoiceBundle as any,
      response: { status: '201' },
    };
  }

  private async processLicenseOrderEntry(
    orderClaims: ClaimsRecord,
    offerId: string,
  ): Promise<BundleEntry | ErrorEntry> {
    return this.offerOrderService.processLicenseOrderEntry(orderClaims, offerId);
  }

  private async processActivatedTenantOrderEntry(
    orderClaims: ClaimsRecord,
    offerId: string,
    matchedOfferClaims: ClaimsRecord,
  ): Promise<BundleEntry | ErrorEntry> {
    const verification = await verifyOrderPaymentConfirmation({ orderClaims, offerClaims: matchedOfferClaims });
    if (!verification.verified) {
      throw new ManagerError(`Payment confirmation failed for offerId '${offerId}'.`, IssueType.Conflict);
    }

    const tenantId = String(matchedOfferClaims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
    const sector = String(
      matchedOfferClaims[ClaimsOfferSchemaorg.category]
      || matchedOfferClaims[ClaimsServiceSchemaorg.category]
      || '',
    ).trim();
    if (!tenantId || !sector) {
      throw new ManagerError('Activated tenant Offer is missing tenant alternateName or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector as Sector, tenantId);
    const quantity = Number(matchedOfferClaims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1);
    const expiryDate = new Date(Date.now());
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      const license: DeviceLicense = {
        id: licenseId,
        tenantId,
        orderId: verification.invoiceId || offerId,
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'available',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp,
      };
      licenseDocs.push({ id: licenseId, status: license.status, sequence: 0, content: license });
    }
    await this.vaultRepository.put(tenantVaultId, licenseDocs, getEnvSectionId('device-licenses'));

    let activationCode: string | undefined;
    const legalRepEmail = matchedOfferClaims[ClaimsPersonSchemaorg.email] as string | undefined;
    const legalRepRole = getPersonOccupationClaim(matchedOfferClaims as Record<string, any> | undefined);
    if (legalRepEmail && legalRepRole) {
      try {
        ({ activationCode } = await issueActivationCodeFromPool({
          vaultRepository: this.vaultRepository,
          kmsService: this.kmsService,
          tenantVaultId,
          userClass: 'employee',
          type: 'mobile',
          email: legalRepEmail,
          role: legalRepRole,
        }));
      } catch (e: any) {
        this.logger.warn?.(
          `[HostingManager] Failed to auto-issue legal rep activation code after activation order: ${String(e?.message || e)}`,
        );
      }
    }

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const tenantDid = String(matchedOfferClaims[ClaimsOrganizationSchemaorg.identifier] || '').trim() || `urn:tenant:${tenantId}`;
    const paymentCommunication = await buildPaymentCommunication({
      offerId,
      tenantId,
      tenantDid,
      senderDid: hostDid,
      email: matchedOfferClaims[ClaimsPersonSchemaorg.email] as string | undefined,
      legalName: matchedOfferClaims[ClaimsOrganizationSchemaorg.legalName] as string | undefined,
      addressCountry: matchedOfferClaims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined,
      addressRegion: matchedOfferClaims[ClaimsOrganizationSchemaorg.addressRegion] as string | undefined,
      addressLocality: matchedOfferClaims[ClaimsOrganizationSchemaorg.addressLocality] as string | undefined,
      postalCode: matchedOfferClaims[ClaimsOrganizationSchemaorg.postalCode] as string | undefined,
      streetAddress: matchedOfferClaims[ClaimsOrganizationSchemaorg.streetAddress] as string | undefined,
      activationCode,
      activationCategory: activationCode ? 'professional' : undefined,
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
      invoiceId: verification.invoiceId,
      paymentConfirmed: true,
      ...readOfferPaymentContext(matchedOfferClaims),
    });
    paymentCommunication.claims[ClaimsOrganizationSchemaorg.alternateName] = tenantId;

    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || verification.invoiceId
        || offerId,
      ),
      subjectReference: tenantDid,
      issuerReference: hostDid,
      recipientReference: tenantDid,
      issuedAt: String(
        paymentCommunication.claims['org.schema.Order.invoiceIssuedAt']
        || new Date().toISOString(),
      ),
      amount: String(matchedOfferClaims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(matchedOfferClaims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
    });

    const hostCollectionName = this.hostRuntime.hostCollectionName;
    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }
    const communicationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims: paymentCommunication.claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(paymentCommunication.claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: paymentCommunication.claims, invoiceBundle },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Organization-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
      resource: invoiceBundle as any,
      response: { status: '201' },
    };
  }

  /**
   * Processes a new organization registration entry, creating a provisional record.
   */
  private async processRegistrationEntry(
    entry: BundleEntry,
    environment?: string,
    jobMeta?: DidCommDecodedMetadata,
  ): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
    const entryType = entry.type || 'Organization-unknown';

    if (!claims) {
      return this.handleError(new ManagerError('Malformed entry: missing meta.claims', IssueType.Required), entryType, entry.meta);
    }

    try {
      const normalizedClaims = this.applyLegalOrganizationIdentityCompatibility(claims);
      validateNewOrganizationClaims(normalizedClaims);
      const alternateName = normalizedClaims[ClaimsOrganizationSchemaorg.alternateName] as string;

      if (!alternateName) {
        throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
      }

      let validatedSector: Sector | undefined;

      if (alternateName !== 'host') {
        if (!isValidTenantAlternateName(alternateName)) {
          throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
        }

        const requestedSector = normalizedClaims[ClaimsServiceSchemaorg.category] as Sector;
        if (!requestedSector) {
          throw new ManagerError(`Missing required claim for new tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
        }
        if (requestedSector === Sector.SYSTEM) {
          throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
        }
        if (!this.config.sectorsAllowed.includes(requestedSector)) {
          throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
        }
        validatedSector = requestedSector;

        // ARCHITECTURAL NOTE: This is the ONLY place a vault existence check should occur.
        // It happens during the initial provisional request to prevent duplicate alternateNames.
        const vaultId = getTenantVaultId(validatedSector, alternateName);
        if (await this.vaultRepository.vaultExists(vaultId)) {
          throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
        }
      }

      const { organization, person, service } = this.extractResources(normalizedClaims, environment);
      const processedService = await this._handleServiceAttachment(service);
      let processedClaims = { ...normalizedClaims, ...(processedService?.meta.claims || {}) };

      if (alternateName === 'host') {
        await this.persistHostConfig(organization, processedClaims, [person, processedService!]);
      } else {
        processedClaims = await this.createPendingTenantRegistrationFromClaims({
          claims: normalizedClaims,
          environment,
          jobMeta,
        });
      }

      return {
        type: BundleEntryType.OrgRegistrationOffer,
        meta: { claims: processedClaims },
        resource: {
          resourceType: 'Organization',
          id: organization.id,
        },
        response: { status: '201' },
      };
    } catch (error: any) {
      console.log('--- DEBUG: Caught error in processRegistrationEntry ---', error);
      return this.handleError(error, entryType, entry.meta);
    }
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta: meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      this.logger.error('Unexpected error during registration processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
        },
      };
    }
  }

  private async persistHostConfig(org: IncludedResource, allClaims: ClaimsRecord, contained: IncludedResource[]) {
    const hostCollectionName = generateTenantCollectionNameFromClaims(allClaims);
    const logicalVaultId = 'host';

    await this.vaultRepository.createNewVault({ id: hostCollectionName });
    await this.kmsService.provisionKeys(logicalVaultId);
    
    const publicKeys = await this.kmsService.getPublicJwks(logicalVaultId);

    const didId = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: didId, alsoKnownAs: [] };
    const didConfigServices = initializeHostServicesConfig(this.config.sectorsAllowed, this.config.nodeEnv, this.config.networkMode);
    const baseUrl = this.config.apiBaseUrl;
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    const legacySignAlg = this.config.legacySignAlg;
    const legacyX5u = legacySignAlg && this.config.legacyX509DerBase64
      ? `${baseUrl}/host/cds-${this.config.host.coverageScope || 'EU'}/v1/${this.config.networkMode}/.well-known/x509.der`
      : undefined;
    const legacyChain = this.config.legacyX509DerBase64
      ? [this.config.legacyX509DerBase64, ...(this.config.legacyX509ChainBase64 || [])]
      : this.config.legacyX509ChainBase64;
    applyLegacyX509Metadata(didDocument, legacySignAlg, legacyX5u, legacyChain);
    didDocument.service = populateDidDocumentServices(didId, baseUrl, didConfigServices, false, {} as any);

    const hostConfig: OrganizationConfig = {
      id: org.id,
      type: EntityType.Organization,
      status: EntityLifecycleStatus.Active,
      claims: allClaims,
      didConfig: { service: didConfigServices },
      didDocument: didDocument,
      networkStatus: [], // Host does not participate in networks as a tenant.
      legacySignAlg: legacySignAlg,
      legacyX509DerBase64: this.config.legacyX509DerBase64,
      legacyX509ChainBase64: this.config.legacyX509ChainBase64,
      meta: { lastUpdated: new Date().toISOString() },
    };

    // Create host self-description and legal participant VCs for well-known endpoints.
    const hostSignerKid = publicKeys.keys.find((key: any) => key.use === 'sig' && key.purpose === 'vc_sign')?.kid
      || publicKeys.keys.find((key) => key.use === 'sig')?.kid;
    if (!hostSignerKid) {
      throw new ManagerError('Host signing key not found, cannot issue host VCs.', IssueType.Exception);
    }
    const legalParticipantOptions = buildGaiaXLegalParticipantOptionsFromClaims({
      claims: allClaims,
      webDomain: baseUrl,
      did: didId,
      issuerDid: didId,
    });
    const governanceVcPayload = createGaiaXLegalParticipantCredential(legalParticipantOptions) as Omit<VerifiableCredentialV2, 'proof'>;
    const govDetachedJws = await this.kmsService.createDetachedJws(governanceVcPayload, hostSignerKid, logicalVaultId, 'vc_sign');
    const governanceVc: VerifiableCredentialV2 = {
      ...governanceVcPayload,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${didId}#${hostSignerKid}`,
        jws: govDetachedJws,
      }],
    };

    const selfDescriptionPayload = { ...governanceVcPayload, issuer: didId } as Omit<VerifiableCredentialV2, 'proof'>;
    const selfDescDetachedJws = await this.kmsService.createDetachedJws(selfDescriptionPayload, hostSignerKid, logicalVaultId, 'vc_sign');
    const selfDescriptionVc: VerifiableCredentialV2 = {
      ...selfDescriptionPayload,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${didId}#${hostSignerKid}`,
        jws: selfDescDetachedJws,
      }],
    };

    hostConfig.governanceVc = governanceVc;
    hostConfig.selfDescriptionVc = selfDescriptionVc;

    if (this.isLedgerRegistrationEnabled()) {
      const containedService = this.extractContainedService(contained);
      const serviceEvidence = this.extractServiceEvidence(containedService);
      const orgId = (allClaims as any)[ClaimsOrganizationSchemaorg.identifier] || org.id;
      await registerOrganizationOnLedger({
        ledgerConfig: this.config.ledger,
        hostJurisdiction: this.config.host.jurisdiction,
        namespace: this.config.namespace,
        hostExternalDomain: this.config.hostExternalDomain,
        logger: this.logger,
        orgId,
        organization: org,
        config: hostConfig,
        evidence: serviceEvidence,
        role: 'host',
        sector: 'system' as Sector,
        jurisdiction: this.config.host.jurisdiction,
      });
    }

    const docToProtect: ConfidentialStorageDoc = {
      id: logicalVaultId,
      status: hostConfig.status,
      sequence: 0,
      content: hostConfig,
    };

    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, logicalVaultId);
    await this.vaultRepository.put(hostCollectionName, [secureDoc], getEnvSectionId('tenants'));

    const mtlsCertPem = process.env.ICA_MTLS_CERT_PEM;
    const mtlsKeyPem = process.env.ICA_MTLS_KEY_PEM;
    const mtlsCaPem = process.env.ICA_MTLS_CA_PEM;
    if (mtlsCertPem && mtlsKeyPem) {
      const mtlsDoc: ConfidentialStorageDoc = {
        id: 'ica-mtls',
        status: EntityLifecycleStatus.Active,
        sequence: 0,
        content: { certPem: mtlsCertPem, keyPem: mtlsKeyPem, caPem: mtlsCaPem },
      };
      const secureMtlsDoc = await this.kmsService.protectConfidentialData(mtlsDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureMtlsDoc], getEnvSectionId('pki'));
    }

    const legalParticipantDoc: ConfidentialStorageDoc = { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: governanceVc };
    const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: selfDescriptionVc };
    const secureLegalParticipantDoc = await this.kmsService.protectConfidentialData(legalParticipantDoc, logicalVaultId);
    const secureLegacyVcDoc = await this.kmsService.protectConfidentialData(legacyVcDoc, logicalVaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, logicalVaultId);
    await this.vaultRepository.put(hostCollectionName, [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc], getEnvSectionId('.well-known'));
    
    const [adminPerson, processedService] = contained;
    if (adminPerson) {
      const adminDoc: ConfidentialStorageDoc = { id: adminPerson.id, status: 'active', sequence: 0, content: adminPerson };
      const secureAdminDoc = await this.kmsService.protectConfidentialData(adminDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureAdminDoc], getEnvSectionId('employees'));
    }
    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureServiceDoc], getEnvSectionId('services'));
    }
  }

  public async ensureAuthorityTenant(params: {
    alternateName: string;
    role: 'ica' | 'ca';
    externalDomain?: string;
  }): Promise<void> {
    const { alternateName, role, externalDomain } = params;
    const sector = Sector.SYSTEM;
    const vaultId = getTenantVaultId(sector, alternateName);
    const hostCollectionName = this.hostRuntime.hostCollectionName;
    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }

    const existing = await this.vaultRepository.get<ConfidentialStorageDoc>(hostCollectionName, vaultId, getEnvSectionId('tenants'));
    if (existing) return;

    await this.kmsService.provisionKeys(vaultId);
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const didId = createHostedDidWeb(hostDid, alternateName, {
      jurisdiction: this.config.host.jurisdiction || 'es',
      version: 'v1',
      sector,
    });

    const didConfigServices = role === 'ica'
      ? [{
          id: '#test-network:ica',
          type: 'ApiService',
          serviceEndpoint: 'csr',
          actions: ['_enroll'],
          selector: { section: 'test-network', format: 'ica', sector },
        }]
      : [];

    const didDocument = populateDidDocumentFromJwks({ '@context': 'https://www.w3.org/ns/did/v1', id: didId, alsoKnownAs: [] }, publicKeys);
    didDocument.service = populateDidDocumentServices(
      didId,
      this.config.apiBaseUrl,
      didConfigServices,
      true,
      { alternateName, jurisdiction: this.config.host.jurisdiction || 'es', version: 'v1', sector },
    );
    if (externalDomain) {
      didDocument.alsoKnownAs = didDocument.alsoKnownAs || [];
      didDocument.alsoKnownAs.push(`did:web:${externalDomain}`);
    }

    const idType = this.config.host.idType || 'TAX';
    const idValueRaw = `${this.config.host.idValue || 'GWCORE'}-${role.toUpperCase()}`;
    const idValue = idValueRaw.replace(/[^a-zA-Z0-9]/g, '');

    const claims: ClaimsRecord = {
      [ClaimsOrganizationSchemaorg.legalName]: this.config.host.legalName || 'GW CORE Host',
      [ClaimsOrganizationSchemaorg.alternateName]: alternateName,
      [ClaimsOrganizationSchemaorg.addressCountry]: this.config.host.jurisdiction || 'es',
      [ClaimsOrganizationSchemaorg.identifierType]: idType,
      [ClaimsOrganizationSchemaorg.identifierValue]: idValue,
      [ClaimsServiceSchemaorg.category]: sector,
      ...(externalDomain ? { [ClaimsOrganizationSchemaorg.url]: `https://${externalDomain}` } : {}),
    };

    const orgUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: this.getCurrentUrnNetwork(),
      jurisdiction: claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector,
      idType,
      idValue,
    });
    (claims as any)[ClaimsOrganizationSchemaorg.identifier] = orgUrn;

    const authorityConfig: OrganizationConfig = {
      id: determineResourceId(orgUrn, this.config.nodeEnv),
      type: EntityType.Organization,
      status: EntityLifecycleStatus.Active,
      claims,
      didConfig: { service: didConfigServices },
      didDocument,
      networkStatus: [],
      legacySignAlg: this.config.legacySignAlg,
      legacyX509DerBase64: this.config.legacyX509DerBase64,
      legacyX509ChainBase64: this.config.legacyX509ChainBase64,
      meta: { lastUpdated: new Date().toISOString(), role },
    };

    const docToProtect: ConfidentialStorageDoc = {
      id: vaultId,
      status: authorityConfig.status,
      sequence: 0,
      content: authorityConfig,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureDoc], getEnvSectionId('tenants'));
  }

  /**
   * Finalizes a tenant's configuration, saves it, and grants initial 'test' network access.
   */
  private async persistTenantConfig(
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    contained: IncludedResource[],
    sector: Sector,
  ) {
    const vaultId = getTenantVaultId(sector, altName);
    const tenantCollectionName = generateTenantCollectionNameFromClaims(allClaims);
    
    // The vault is created here, during finalization. The existence check was done previously.
    await this.vaultRepository.createNewVault({ id: tenantCollectionName });
    await this.kmsService.provisionKeys(vaultId);
    
    const finalTenantConfig = await this.finalizeTenantConfig(org, altName, allClaims, sector, vaultId);
    
    // 6. Persist all artifacts
    const attributes = AllowedIndexableClaims.organizationRegistry
      .map(claimKey => ({ name: claimKey, value: String(allClaims[claimKey]), ...(claimKey === ClaimsOrganizationSchemaorg.alternateName && { unique: true }) }))
      .filter(attr => attr.value !== 'undefined' && attr.value !== 'null');

    const tenantRegistrationDoc: ConfidentialStorageDoc = {
      id: vaultId,
      status: finalTenantConfig.status,
      sequence: 0,
      indexed: { attributes, hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' } },
      content: finalTenantConfig,
    };
    const hostCollectionName = this.hostRuntime.hostCollectionName;
    const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));

    // Save VCs and other resources into the TENANT's own vault
    const legalParticipantDoc: ConfidentialStorageDoc = { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
    const secureLegalParticipantDoc = await this.kmsService.protectConfidentialData(legalParticipantDoc, vaultId);
    const secureLegacyVcDoc = await this.kmsService.protectConfidentialData(legacyVcDoc, vaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc], getEnvSectionId('.well-known'));

    const [legalRep, processedService] = contained;
    if (legalRep) {
      const legalRepDoc: ConfidentialStorageDoc = { id: legalRep.id, status: 'active', sequence: 0, content: legalRep };
      const secureLegalRepDoc = await this.kmsService.protectConfidentialData(legalRepDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureLegalRepDoc], getEnvSectionId('employees'));
    }
    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], getEnvSectionId('services'));
    }

    // Handoff: The tenant may now initiate a separate request for production network onboarding.
  }

  /**
   * Generates the final tenant configuration, including DIDs and VCs.
   */
  private async finalizeTenantConfig(
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    sector: Sector,
    vaultId: string,
    options?: {
      primaryDid?: string;
      publicTenantUrl?: string;
      operationalTenantUrl?: string;
      governanceVc?: VerifiableCredentialV2;
      networkName?: NetworkName;
    },
  ): Promise<OrganizationConfig> {
    const publicKeys = await this.kmsService.getPublicJwks(vaultId);

    // 1. Separate Organization claims from Service claims for the provider object
    const orgClaims: ClaimsRecord = {};
    const serviceClaims: ClaimsRecord = {};
    for (const key in allClaims) {
      if (key.startsWith('org.schema.Service')) {
        serviceClaims[key] = allClaims[key];
      } else if (key.startsWith('org.schema.Organization') || key.startsWith('org.schema.Person')) {
        orgClaims[key] = allClaims[key];
      }
    }
    // Keep the tenant's sector available in `claims` for deterministic vault/collection naming.
    orgClaims[ClaimsServiceSchemaorg.category] = allClaims[ClaimsServiceSchemaorg.category];

    // 2. Construct DID and DID Document
    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace, network: this.getCurrentUrnNetwork(),
      jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: sector, idType: allClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: allClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const context = { jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector: sector };
    const hostedDid = createHostedDidWeb(hostDid, altName, context);
    const publicTenantUrl = options?.publicTenantUrl || allClaims[ClaimsOrganizationSchemaorg.url] as string | undefined;
    const operationalTenantUrl = this.getOperationalServiceBaseUrl(allClaims, options);
    const externalDid = options?.primaryDid
      || (publicTenantUrl && publicTenantUrl.startsWith('https://') ? `did:web:${new URL(publicTenantUrl).hostname}` : undefined);
    const primaryDid = externalDid || hostedDid;
    const hostedPublicUrl = `${this.config.apiBaseUrl}/${altName}/cds-${String(allClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').toLowerCase()}/v1/${sector}`;
    const isHosted = !publicTenantUrl?.startsWith('https://')
      || (!!operationalTenantUrl && !!publicTenantUrl && new URL(operationalTenantUrl).host !== new URL(publicTenantUrl).host);
    const alsoKnownAs = this.buildTenantAlsoKnownAs({
      tenantUrn,
      primaryDid,
      externalDid,
      hostedDid,
      publicTenantUrl,
      hostedPublicUrl: isHosted ? hostedPublicUrl : undefined,
    });
    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: primaryDid, alsoKnownAs: alsoKnownAs };
    const didConfigServices = initializeTenantServicesConfig(
      sector,
      [],
      allClaims[ClaimsServiceSchemaorg.serviceType] as string | undefined,
      allClaims[SERVICE_ADDITIONAL_TYPE_CLAIM] as string | undefined,
    );
    const publicBaseUrl = isHosted ? this.config.apiBaseUrl : (publicTenantUrl || this.config.apiBaseUrl);
    const serviceBaseUrl = operationalTenantUrl || publicBaseUrl;
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    const tenantContext = { alternateName: altName, jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector };
    didDocument.service = populateDidDocumentServices(primaryDid, publicBaseUrl, didConfigServices, isHosted, tenantContext, serviceBaseUrl);
    const legacySignAlg = this.config.legacySignAlg;
    const legacyX5u = legacySignAlg && this.config.legacyX509DerBase64
      ? `${publicBaseUrl}/.well-known/x509.der`
      : undefined;
    const legacyChain = this.config.legacyX509DerBase64
      ? [this.config.legacyX509DerBase64, ...(this.config.legacyX509ChainBase64 || [])]
      : this.config.legacyX509ChainBase64;
    applyLegacyX509Metadata(didDocument, legacySignAlg, legacyX5u, legacyChain);
    
    // 3. Create provisional, host-signed legal-participant.vc.json for test/demo purposes
    const hostJwks = await this.kmsService.getPublicJwks('host');
    const hostSignerKid = hostJwks.keys.find((k: any) => k.use === 'sig' && k.purpose === 'vc_sign')?.kid
      || hostJwks.keys.find(k => k.use === 'sig')?.kid;
    if (!hostSignerKid) {
      throw new ManagerError('Host signing key not found, cannot issue provisional VC.', IssueType.Exception);
    }
    const legalParticipantOptions = this.buildGaiaXLegalParticipantOptionsForTenant({
      claims: allClaims,
      webDomain: publicBaseUrl,
      did: primaryDid,
      issuerDid: hostDid,
      alternateName: altName,
      sector,
    });
    let governanceVc: VerifiableCredentialV2;
    if (options?.governanceVc) {
      governanceVc = options.governanceVc;
    } else {
      const governanceVcPayload = createGaiaXLegalParticipantCredential(legalParticipantOptions) as Omit<VerifiableCredentialV2, 'proof'>;
      const govDetachedJws = await this.kmsService.createDetachedJws(governanceVcPayload, hostSignerKid, 'host', 'vc_sign');
      governanceVc = {
        ...governanceVcPayload,
        proof: [{
          type: 'JsonWebSignature2020',
          created: new Date().toISOString(),
          proofPurpose: 'assertionMethod',
          verificationMethod: `${hostDid}#${hostSignerKid}`,
          jws: govDetachedJws,
        }],
      };
    }

    // 4. Create self-signed self-description.json
    const tenantSignerKid = publicKeys.keys.find(k => k.use === 'sig')?.kid;
    if (!tenantSignerKid) {
      throw new ManagerError('Tenant signing key not found, cannot issue self-description.', IssueType.Exception);
    }
    const selfDescriptionOptions = this.buildGaiaXLegalParticipantOptionsForTenant({
      claims: allClaims,
      webDomain: publicBaseUrl,
      did: primaryDid,
      issuerDid: primaryDid,
      alternateName: altName,
      sector,
    });
    const selfDescriptionPayload = createGaiaXLegalParticipantCredential(selfDescriptionOptions) as Omit<VerifiableCredentialV2, 'proof'>;
    const selfDescDetachedJws = await this.kmsService.createDetachedJws(selfDescriptionPayload, tenantSignerKid, vaultId, 'vc_sign');
    const selfDescriptionVc: VerifiableCredentialV2 = {
        ...selfDescriptionPayload,
        proof: [{
            type: 'JsonWebSignature2020',
            created: new Date().toISOString(),
            proofPurpose: 'assertionMethod',
            verificationMethod: `${primaryDid}#${tenantSignerKid}`,
            jws: selfDescDetachedJws,
        }]
    };

    // 5. Construct the final OrganizationConfig
    const tenantConfig: OrganizationConfig = {
      id: org.id,
      type: EntityType.Organization,
      status: EntityLifecycleStatus.Active, // Gateway account status is active
      networkStatus: [
        {
          networkName: options?.networkName || NetworkName.Test,
          status: NetworkAccessStatus.Active,
          activationDate: new Date().toISOString(),
        }
      ],
      claims: orgClaims,
      provider: {
        service: serviceClaims,
      },
      didConfig: { service: didConfigServices },
      didDocument: didDocument,
      governanceVc: governanceVc,
      selfDescriptionVc: selfDescriptionVc,
      legacySignAlg: legacySignAlg,
      legacyX509DerBase64: this.config.legacyX509DerBase64,
      legacyX509ChainBase64: this.config.legacyX509ChainBase64,
      meta: { lastUpdated: new Date().toISOString() },
    };

    return applyTenantAuthorizationStatus(tenantConfig, 'active');
  }

  private buildGaiaXLegalParticipantOptionsForTenant(params: {
    claims: ClaimsRecord;
    webDomain: string;
    did: string;
    issuerDid: string;
    alternateName: string;
    sector: Sector;
  }) {
    const { claims, webDomain, did, issuerDid, alternateName, sector } = params;
    const enrichedClaims: ClaimsRecord = { ...claims };

    if (this.isDemoSecurityMode()) {
      const fallbackName = String(
        enrichedClaims[ClaimsOrganizationSchemaorg.legalName]
        || enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue]
        || alternateName
        || '',
      ).trim();
      if (fallbackName && !String(enrichedClaims[ClaimsOrganizationSchemaorg.legalName] || '').trim()) {
        enrichedClaims[ClaimsOrganizationSchemaorg.legalName] = fallbackName;
      }
      const fallbackCountry = String(
        enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry]
        || this.config.host.jurisdiction
        || 'ES',
      ).trim();
      if (fallbackCountry && !String(enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
        enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
      }
      const fallbackVat = String(
        enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue]
        || alternateName
        || '',
      ).trim();
      if (fallbackVat && !String(enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim()) {
        enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue] = fallbackVat;
      }
      if (!String(enrichedClaims[ClaimsServiceSchemaorg.termsOfService] || '').trim()) {
        enrichedClaims[ClaimsServiceSchemaorg.termsOfService] = 'https://example.org/terms';
      }
      this.logger?.warn?.('[HostingManager] demo Gaia-X fallback', {
        alternateName,
        sector,
        legalName: enrichedClaims[ClaimsOrganizationSchemaorg.legalName],
        identifierValue: enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue],
        addressCountry: enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry],
        termsOfService: enrichedClaims[ClaimsServiceSchemaorg.termsOfService],
      });
    }

    try {
      return buildGaiaXLegalParticipantOptionsFromClaims({
        claims: enrichedClaims,
        webDomain,
        did,
        issuerDid,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ManagerError(
        `Missing required claims to build Gaia-X Legal Participant credential for '${alternateName}': ${message}`,
        IssueType.Required,
      );
    }
  }


  private async _handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    if (!service) return undefined;
    const claims = service.meta?.claims as Record<string, unknown> | undefined;
    if (!claims) return service;
    const termsRaw = claims[ClaimsServiceSchemaorg.termsOfService];
    if (typeof termsRaw !== 'string') return service;
    let termsOfService = termsRaw as string | undefined;

    if (termsOfService && !termsOfService.startsWith('http')) {
      try {
        if (termsOfService.startsWith('data:')) {
          const parts = termsOfService.split(',');
          if (parts.length !== 2) { throw new Error('Malformed data URL.'); }
          termsOfService = parts[1];
        }
        const pdfBytes = Buffer.from(termsOfService, 'base64');
        const serviceMeta = service.meta as any;
        const verification = serviceMeta.verification || {};
        const evidenceList = Array.isArray(verification.evidence) ? verification.evidence : [];

        // Evidence extraction is best-effort: unsigned or malformed PDFs should still upload.
        try {
          if (pdfBytes.includes(Buffer.from('/ByteRange'))) {
            const { evidence } = buildPdfSignatureEvidence(pdfBytes, 'sha256');
            evidenceList.push(evidence);
          }
        } catch (e) {
          this.logger?.warn?.(`[HostingManager] Skipping PDF signature evidence: ${(e as Error).message}`);
        }

        serviceMeta.verification = { ...verification, evidence: evidenceList };
        const uploadResult = await this.storageAdapter.upload(pdfBytes, 'application/pdf');
        if (!uploadResult) { throw new Error('Storage adapter returned undefined result.'); }
        const { publicUrl, encodedMultiHash } = uploadResult;
        service.meta.claims[ClaimsServiceSchemaorg.termsOfService] = publicUrl;
        (service.meta.claims as any)[`${ClaimsServiceSchemaorg.termsOfService}#hash`] = encodedMultiHash;
      } catch (error) {
        const e = error as Error;
        throw new ManagerError(`Error processing service attachment: ${e.message}`, IssueType.Invalid);
      }
    }
    return service;
  }

  private async requestIcaEnrollment(params: { organizationClaims: ClaimsRecord; evidence?: PdfSignatureEvidence[]; tenantVaultId: string }) {
    const icaDomain = process.env.ICA_EXTERNAL_DOMAIN;
    const icaSlug = slugFromDomain(icaDomain);
    if (!icaSlug) return;

    const jurisdiction = String(this.config.host.jurisdiction || 'es').toLowerCase();
    const baseUrl = icaDomain ? `https://${icaDomain}` : this.config.apiBaseUrl;
    // Transitional contract:
    // this placeholder endpoint still models a direct CSR/evidence enrollment.
    // The target flow is stricter:
    // hosting validation -> signed adhesion PDF -> Fabric operational
    // bootstrap/license -> local key generation + enroll -> dataspace ICA Host VC.
    // Do not treat this call as the final authority for host accreditation.
    const url = `${baseUrl}/${icaSlug}/cds-${jurisdiction}/v1/system/test-network/ica/csr/_enroll`;

    const payload = {
      csr: 'DEMO-CSR',
      organization: params.organizationClaims,
      evidence: params.evidence,
      metadata: { environment: 'test-network' },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo' },
        body: JSON.stringify(payload),
      });
      const location = res.headers.get('location') || res.headers.get('Location') || '';
      let resultResource: any | undefined;

      if (res.ok) {
        const data = await res.json().catch(() => undefined);
        resultResource = data?.data?.[0]?.resource;
      } else if (res.status === 202 && location) {
        resultResource = await this.pollIcaResult(location);
      } else {
        const text = await res.text();
        this.logger.warn?.(`[HostingManager] ICA enroll request failed: ${res.status} ${text}`);
      }

      if (resultResource) {
        await this.storeIcaMessage(params.tenantVaultId, resultResource);
      }
    } catch (error: any) {
      this.logger.warn?.(`[HostingManager] ICA enroll request failed: ${String(error?.message || error)}`);
    }
  }

  private async pollIcaResult(url: string): Promise<any | undefined> {
    const attempts = 5;
    const delayMs = 2000;
    for (let i = 0; i < attempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' } });
      if (res.status === 202) continue;
      if (!res.ok) return undefined;
      const data = await res.json().catch(() => undefined);
      return data?.data?.[0]?.resource;
    }
    return undefined;
  }

  private async storeIcaMessage(tenantVaultId: string, resultResource: any): Promise<void> {
    const message = {
      type: 'IcaEnrollResponse-v1.0',
      id: resultResource?.id || `urn:uuid:${uuidv4()}`,
      resource: resultResource,
    };

    const doc: ConfidentialStorageDoc = {
      id: message.id,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: message,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(doc, tenantVaultId);
    await this.vaultRepository.put(tenantVaultId, [secureDoc], getEnvSectionId('messaging'));
  }

  private isLedgerRegistrationEnabled(): boolean {
    if (typeof this.config.ledger?.enabled === 'boolean') {
      return this.config.ledger.enabled;
    }
    const env = String(this.config.nodeEnv || '').toLowerCase();
    return env !== 'demo' && env !== 'test';
  }

  private extractContainedService(contained?: IncludedResource[] | undefined): IncludedResource | undefined {
    if (!contained || !Array.isArray(contained)) return undefined;
    return contained.find((resource) => resource?.type === 'Service');
  }

  private extractServiceEvidence(service?: IncludedResource): PdfSignatureEvidence[] | undefined {
    if (!service) return undefined;
    const verification = (service.meta as any)?.verification;
    const evidence = verification?.evidence;
    if (!evidence) return undefined;
    return Array.isArray(evidence) ? evidence : [evidence];
  }

  private extractResources(claims: ClaimsRecord, environment?: string) {
    // console.log('--- DEBUG: Input claims for extractResources ---', JSON.stringify(claims, null, 2));
    const resourceTypes = ['Organization', 'Person', 'Service'];
    const resources: Record<string, any> = {};

    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = { '@type': type };
      let claimFound = false;
      for (const key in claims) {
        if (key.startsWith(`org.schema.${type}.`)) {
          resourceClaims[key] = claims[key];
          claimFound = true;
        }
      }
      if (claimFound) {
        const identifierClaim = resourceClaims[`org.schema.${type}.identifier`];
        const resourceId = determineResourceId(identifierClaim, environment);
        resources[type.toLowerCase()] = {
          id: resourceId,
          type: type,
          meta: { claims: resourceClaims },
        };
      }
    }
    // For individual orgs: allow missing Person resource if org claims include owner.telephone
    const isIndividualOrg = !!claims['org.schema.Organization.owner.telephone'];
    if (!resources.organization || !resources.service || (!resources.person && !isIndividualOrg)) {
      throw new ManagerError(
        'Incomplete claims: Organization and Service are required. Person is required for legal orgs, but not for individual orgs.',
        IssueType.Required
      );
    }
    // Return with person if present, else only org and service
    return {
      organization: resources.organization,
      ...(resources.person ? { person: resources.person } : {}),
      service: resources.service,
    } as any;
  }
}
