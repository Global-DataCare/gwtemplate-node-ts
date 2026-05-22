// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/HostingManager.ts

import { v4 as uuidv4 } from 'uuid';
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
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
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
import { TenantsCacheManager } from './TenantsCacheManager';
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
import { buildPdfSignatureEvidence, PdfSignatureEvidence } from '../utils/pdf-evidence';
import { getPersonOccupationClaim } from '../utils/occupation';
import { ManageAssetOrganization } from '../blockchain/fabric/v3/manageAssetOrganization';
import { resolveIdentityChannel } from '../utils/ledger';
import { slugFromDomain } from '../utils/slug';
import { getEnvSectionId } from '../utils/section-env';
import { ClearingHouseService, IClearingHouseService } from '../services/ClearingHouseService';
import {
  DefaultActivationTrustAdapter,
  IActivationTrustAdapter,
} from '../adapters/activation-trust.adapter';

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
  private tenantsCacheManager: TenantsCacheManager;
  private storageAdapter: IStorageAdapter;
  private logger: ILogger;
  private config: IServerConfig;
  private clearingHouseService: IClearingHouseService;
  private activationTrustAdapter: IActivationTrustAdapter;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    storageAdapter: IStorageAdapter,
    logger: ILogger,
    config: IServerConfig,
    clearingHouseService?: IClearingHouseService,
    activationTrustAdapter?: IActivationTrustAdapter,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.storageAdapter = storageAdapter;
    this.logger = logger;
    this.config = config;
    this.clearingHouseService = clearingHouseService || new ClearingHouseService();
    this.activationTrustAdapter = activationTrustAdapter || new DefaultActivationTrustAdapter(this.clearingHouseService);
  }

  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    const { organization, person, service } = this.extractResources(hostClaims);
    const processedService = await this._handleServiceAttachment(service);
    const allClaims = { ...hostClaims, ...(processedService?.meta.claims || {}) };
    await this.persistHostConfig(organization, allClaims, [person, processedService!]);
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

  private extractActivationMaterial(entry: BundleEntry, body: any) {
    const entryMeta = (entry?.meta || {}) as Record<string, any>;
    const entryResource = (entry?.resource || {}) as Record<string, any>;
    const primaryDid =
      entryResource?.didDocument?.id
      || entryResource?.organizationDid
      || entryResource?.organization_did
      || entryMeta?.organizationDid
      || entryMeta?.organization_did
      || this.extractDidFromCredential(
        body?.organizationCredential
        || body?.organization_credential
        || entryMeta?.organizationCredential
        || entryMeta?.organization_credential
        || entryResource?.organizationCredential
        || entryResource?.organization_credential
      );

    return {
      vpToken: body?.vp_token || entryMeta?.vp_token || entryResource?.vp_token,
      presentationSubmission:
        body?.presentation_submission
        || entryMeta?.presentation_submission
        || entryResource?.presentation_submission,
      organizationCredential:
        body?.organizationCredential
        || body?.organization_credential
        || entryMeta?.organizationCredential
        || entryMeta?.organization_credential
        || entryResource?.organizationCredential
        || entryResource?.organization_credential,
      representativeCredential:
        body?.representativeCredential
        || body?.representative_credential
        || body?.legalRepresentativeCredential
        || entryMeta?.representativeCredential
        || entryMeta?.representative_credential
        || entryMeta?.legalRepresentativeCredential
        || entryResource?.representativeCredential
        || entryResource?.representative_credential
        || entryResource?.legalRepresentativeCredential,
      primaryDid,
      publicTenantUrl:
        entryResource?.organizationUrl
        || entryResource?.organization_url
        || entryMeta?.organizationUrl
        || entryMeta?.organization_url
        || (typeof primaryDid === 'string' && primaryDid.startsWith('did:web:')
          ? getBaseUrlFromDidWeb(primaryDid)
          : undefined),
    };
  }

  private getIcaDidCreateUrl(): string | undefined {
    const configuredBaseUrl = this.config.ica?.mode === 'internal'
      ? this.config.ica?.internalUrl
      : this.config.ica?.externalUrl || this.config.ica?.internalUrl;
    if (!configuredBaseUrl) {
      return undefined;
    }
    if (configuredBaseUrl.includes('/entity/did/document/_create')) {
      return configuredBaseUrl;
    }
    return `${configuredBaseUrl.replace(/\/+$/, '')}/entity/did/document/_create`;
  }

  private async pollIcaJsonResult(location: string, attempts: number = 5): Promise<any | undefined> {
    let waitMs = 2000;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const res = await fetch(location, {
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
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return undefined;
      }
      return await res.json().catch(() => undefined);
    }
    throw new ManagerError('ICA DID document creation polling timed out.', IssueType.NotSupported);
  }

  private async registerDidDocumentWithIca(params: {
    vpToken: string;
    presentationSubmission?: any;
    organizationCredential: any;
    representativeCredential: any;
    organizationDidDocument: DidDocument;
    controllerDidDocument: DidDocument;
  }): Promise<any | undefined> {
    const url = this.getIcaDidCreateUrl();
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
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        vp_token: params.vpToken,
        presentation_submission: params.presentationSubmission,
        organization: {
          credential: params.organizationCredential,
          did: params.organizationDidDocument.id,
          didDocument: params.organizationDidDocument,
          publicKeyJwk: organizationSigningKey,
        },
        controller: {
          credential: params.representativeCredential,
          did: params.controllerDidDocument.id,
          didDocument: params.controllerDidDocument,
          publicKeyJwk: controllerSigningKey,
        },
      }),
    });

    if (res.status === 202) {
      const location = res.headers.get('location') || res.headers.get('Location') || '';
      if (!location) {
        throw new ManagerError('ICA DID document creation returned 202 Accepted without Location header.', IssueType.NotSupported);
      }
      return await this.pollIcaJsonResult(location);
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

  private async buildControllerEntityConfig(
    legalRep: IncludedResource,
    tenantUrn: string,
    vaultId: string,
    registrationKeys?: { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk },
  ): Promise<EntityConfig> {
    const email = legalRep.meta?.claims?.[ClaimsPersonSchemaorg.email] as string | undefined;
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

    let signerJwk = registrationKeys?.signerJwk;
    let encrypterJwk = registrationKeys?.encrypterJwk;
    if (!signerJwk || !encrypterJwk) {
      const provisioned = await this.kmsService.provisionKeys(employeeUrn);
      signerJwk = provisioned.keys.find(k => (k as any).kty === 'AKP') as PublicJwk | undefined;
      encrypterJwk = provisioned.keys.find(k => (k as any).kty === 'OKP') as PublicJwk | undefined;
    }
    if (!signerJwk?.kid || !encrypterJwk?.kid) {
      throw new ManagerError('Admin keys are missing "kid" properties.', IssueType.Required);
    }

    const verificationMethods: VerificationMethod[] = [
      {
        id: `${employeeUrn}#${signerJwk.kid}`,
        controller: employeeUrn,
        type: 'JsonWebKey2020',
        publicKeyJwk: signerJwk,
      },
      {
        id: `${employeeUrn}#${encrypterJwk.kid}`,
        controller: employeeUrn,
        type: 'JsonWebKey2020',
        publicKeyJwk: encrypterJwk,
      },
    ];

    return {
      id: legalRep.id,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims: legalRep.meta?.claims || {},
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: employeeUrn,
        verificationMethod: verificationMethods,
        authentication: [verificationMethods[0].id],
        keyAgreement: [verificationMethods[1].id],
        service: [],
      },
      didConfig: { service: [] },
      meta: { lastUpdated: new Date().toISOString() },
    };
  }

  private async storeControllerEntityConfig(
    controllerConfig: EntityConfig,
    tenantCollectionName: string,
    vaultId: string,
  ): Promise<void> {
    const verificationMethods = controllerConfig.didDocument?.verificationMethod || [];
    const email = controllerConfig.claims?.[ClaimsPersonSchemaorg.email] as string | undefined;
    const roleCode = getPersonOccupationClaim(controllerConfig.claims as Record<string, any> | undefined);

    const attributesToIndex: ParameterData[] = [
      ...(email ? [{ name: 'email', value: email, unique: true, type: 'string' } as ParameterData] : []),
      ...(roleCode ? [{ name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' } as ParameterData] : []),
      ...verificationMethods
        .map((vm) => (vm.publicKeyJwk as PublicJwk | undefined)?.kid)
        .filter((kid): kid is string => Boolean(kid))
        .map((kid) => ({ name: 'kid', value: kid, unique: false, type: 'string' } as ParameterData)),
    ];
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, vaultId);

    const employeeDoc: ConfidentialStorageDoc = {
      id: controllerConfig.id,
      status: controllerConfig.status,
      sequence: 0,
      content: controllerConfig,
      indexed: { attributes: protectedAttributes },
    };
    const secureEmployeeDoc = await this.kmsService.protectConfidentialData(employeeDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureEmployeeDoc], getEnvSectionId('employees'));
  }

  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    
    try {
      switch (job.resourceType) {
        case 'Organization':
          if (job.action === '_activate') {
            return await this.processOrganizationActivation(job, environment);
          }
          return await this.processOrganizationRegistration(job, environment, isBootstrap);
        case 'Order':
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

  /**
   * Handles activation of an organization backend/connector from ICA-issued proof.
   *
   * TODO(ica-activation):
   * Replace this placeholder with the real flow:
   * 1. Validate the controller-submitted vp_token / ICA proof.
   * 2. Verify organization + representative credentials issued by ICA.
   * 3. Verify that the submitted backend/conector DID document matches the ICA-issued organization DID.
   * 4. Activate/provision the tenant backend in the selected host network.
   */
  private async processOrganizationActivation(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const body = job?.content?.body as any;

    for (const entry of jobEntries) {
      try {
        const resultEntry = await this.processActivationEntry(entry, body, environment, job.content?.meta, job.sector);
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

  private async processActivationEntry(
    entry: BundleEntry,
    body: any,
    environment?: string,
    jobMeta?: DidCommDecodedMetadata,
    hostRegistrySector?: string,
  ): Promise<BundleEntry | ErrorEntry> {
    const activation = this.extractActivationMaterial(entry, body);
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

    validateNewOrganizationClaims(claims);
    const alternateName = claims[ClaimsOrganizationSchemaorg.alternateName] as string;
    if (!alternateName) {
      throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
    }
    if (!isValidTenantAlternateName(alternateName)) {
      throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
    }

    const requestedSector = claims[ClaimsServiceSchemaorg.category] as Sector;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim for activation: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
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

    const { organization, person, service } = this.extractResources(claims, environment);
    const processedService = await this._handleServiceAttachment(service);
    const processedClaims = { ...claims, ...(processedService?.meta.claims || {}) };
    const normalizedPublicUrl = this.normalizeTenantPublicUrl(
      activation.publicTenantUrl
      || (processedClaims[ClaimsOrganizationSchemaorg.url] as string | undefined),
    );
    if (normalizedPublicUrl) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.url] = normalizedPublicUrl;
    }
    if (!(processedClaims as any)[ClaimsOrganizationSchemaorg.identifier]) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = createOrganizationUrn({
        namespace: this.config.namespace,
        network: this.getCurrentUrnNetwork(),
        jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
        sector: requestedSector,
        idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
        idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
      });
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

    const tenantRegistrationDoc: ConfidentialStorageDoc = {
      id: vaultId,
      status: finalTenantConfig.status,
      sequence: 0,
      indexed: { attributes, hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' } },
      content: finalTenantConfig,
    };

    const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
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
    const controllerConfig = await this.buildControllerEntityConfig(person, tenantUrn, vaultId, this.extractRegistrationKeys(jobMeta));
    await this.storeControllerEntityConfig(controllerConfig, tenantCollectionName, vaultId);
    const icaDidRegistration = await this.registerDidDocumentWithIca({
      vpToken: activation.vpToken,
      presentationSubmission: activation.presentationSubmission,
      organizationCredential: activation.organizationCredential,
      representativeCredential: activation.representativeCredential,
      organizationDidDocument: finalTenantConfig.didDocument!,
      controllerDidDocument: controllerConfig.didDocument!,
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
      await this.registerOrganizationOnLedger({
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
    if (job.section === 'individual' && (job.action === '_batch' || job.action === '_search')) {
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

  private splitOwnerValues(value?: string): string[] {
    if (!value) return [];
    return value.split(',').map((v) => v.trim()).filter(Boolean);
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
    const tenantCollectionName = await this.resolveTenantCollectionForIndividuals(tenantVaultId, true);

    const apodo = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    const ownerPhones = this.splitOwnerValues(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = this.splitOwnerValues(claims['org.schema.Organization.owner.email'] as string | undefined);
    if (!apodo || (ownerPhones.length === 0 && ownerEmails.length === 0)) {
      throw new ManagerError(
        `Missing required claims: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    for (const phone of ownerPhones) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: getEnvSectionId('individual'),
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
        sectionId: getEnvSectionId('individual'),
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
    await this.vaultRepository.put(tenantCollectionName, [secureDoc], getEnvSectionId('individual'));

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
    const ownerPhones = this.splitOwnerValues(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = this.splitOwnerValues(claims['org.schema.Organization.owner.email'] as string | undefined);
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
        sectionId: getEnvSectionId('individual'),
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

    const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
    
    const query = {
      sectionId: getEnvSectionId('tenants'),
      where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
    };
    
    const results = await this.vaultRepository.query(hostCollectionName!, query);

    if (results.length === 0) {
      throw new ManagerError(`No pending registration found for offerId: '${offerId}'`, IssueType.NotFound);
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
      await this.registerOrganizationOnLedger({
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

    if (String(this.config.nodeEnv || '').toLowerCase() === 'demo') {
      const serviceEvidence = this.extractServiceEvidence(containedService || service);
      await this.requestIcaEnrollment({
        organizationClaims: processedClaims,
        evidence: serviceEvidence,
        tenantVaultId: vaultId,
      });
    }

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
      ...readOfferPaymentContext(processedClaims),
    };
    const paymentCommunication = await buildPaymentCommunication(paymentContext);

    if (!hostCollectionName) {
      throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
    }
    const communicationDoc: ConfidentialStorageDoc = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: { claims: paymentCommunication.claims },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Organization-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
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
      validateNewOrganizationClaims(claims);
      const alternateName = claims[ClaimsOrganizationSchemaorg.alternateName] as string;

      if (!alternateName) {
        throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
      }

      let validatedSector: Sector | undefined;

      if (alternateName !== 'host') {
        if (!isValidTenantAlternateName(alternateName)) {
          throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
        }

        const requestedSector = claims[ClaimsServiceSchemaorg.category] as Sector;
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

      const { organization, person, service } = this.extractResources(claims, environment);
      const processedService = await this._handleServiceAttachment(service);
      let processedClaims = { ...claims, ...(processedService?.meta.claims || {}) };

      if (alternateName === 'host') {
        await this.persistHostConfig(organization, processedClaims, [person, processedService!]);
      } else {
        const registrationKeys = this.extractRegistrationKeys(jobMeta);
        const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
        const jurisdiction = processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string;
        const isIndividualOrg = !!claims['org.schema.Organization.owner.telephone'];

        let tenantUrn: string | undefined = undefined;
        if (!isIndividualOrg) {
          // Only generate canonical URN for legal orgs
          tenantUrn = createOrganizationUrn({
            namespace: this.config.namespace,
            network: this.getCurrentUrnNetwork(),
            jurisdiction,
            sector: validatedSector!,
            idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
            idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
          });
          (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = tenantUrn;
        } else {
          // For individual orgs, use a simple identifier (e.g., alternateName or a UUID)
          (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = alternateName || organization.id;
        }

        const offerClaims = generateLicenseOffer(
          processedClaims[ClaimsOrganizationSchemaorg.numberOfEmployees] as number,
          hostDid,
          jurisdiction,
          validatedSector!,
          this.config.allowedPaymentMethods
        );
        processedClaims = { ...processedClaims, ...offerClaims };

        const tenantRegistrationDoc: ConfidentialStorageDoc = {
          id: getTenantVaultId(validatedSector!, alternateName),
          status: EntityLifecycleStatus.Pending,
          sequence: 0,
          indexed: {
            attributes: [
              { name: 'status', value: 'pending' },
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

        const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
        const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
        await this.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
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
      ? `${baseUrl}/host/.well-known/x509.der`
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
      await this.registerOrganizationOnLedger({
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
    const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
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
    const idValueRaw = `${this.config.host.idValue || 'UNID'}-${role.toUpperCase()}`;
    const idValue = idValueRaw.replace(/[^a-zA-Z0-9]/g, '');

    const claims: ClaimsRecord = {
      [ClaimsOrganizationSchemaorg.legalName]: this.config.host.legalName || 'UNID',
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
    const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
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
    const externalDid = options?.primaryDid
      || (publicTenantUrl && publicTenantUrl.startsWith('https://') ? `did:web:${new URL(publicTenantUrl).hostname}` : undefined);
    const primaryDid = externalDid || hostedDid;
    const alsoKnownAs = [tenantUrn, ...(externalDid && primaryDid !== externalDid ? [externalDid] : []), ...(hostedDid && primaryDid !== hostedDid ? [hostedDid] : [])];
    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: primaryDid, alsoKnownAs: alsoKnownAs };
    const didConfigServices = initializeTenantServicesConfig(sector);
    const isHosted = !publicTenantUrl?.startsWith('https://');
    const baseUrl = isHosted ? this.config.apiBaseUrl : publicTenantUrl!;
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    const tenantContext = { alternateName: altName, jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector };
    didDocument.service = populateDidDocumentServices(primaryDid, baseUrl, didConfigServices, isHosted, tenantContext);
    const legacySignAlg = this.config.legacySignAlg;
    const legacyX5u = legacySignAlg && this.config.legacyX509DerBase64
      ? `${baseUrl}/.well-known/x509.der`
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
    const legalParticipantOptions = buildGaiaXLegalParticipantOptionsFromClaims({
      claims: allClaims,
      webDomain: baseUrl,
      did: primaryDid,
      issuerDid: hostDid,
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
    const selfDescriptionOptions = buildGaiaXLegalParticipantOptionsFromClaims({
      claims: allClaims,
      webDomain: baseUrl,
      did: primaryDid,
      issuerDid: primaryDid,
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
    
    return tenantConfig;
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

  private async registerOrganizationOnLedger(params: {
    orgId: string;
    organization: IncludedResource;
    config: OrganizationConfig;
    evidence?: PdfSignatureEvidence[];
    role: 'host' | 'tenant';
    sector: Sector;
    jurisdiction?: string;
  }): Promise<void> {
    const mspId = this.config.ledger?.mspId || process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1;
    if (!mspId) {
      throw new ManagerError('Ledger MSP ID is missing. Set LEDGER_MSP_ID.', IssueType.Exception);
    }
    const chaincodeName = this.config.ledger?.chaincodeName || process.env.LEDGER_ORG_CHAINCODE;
    const channelName = this.config.ledger?.channelName
      || resolveIdentityChannel(params.jurisdiction || this.config.host.jurisdiction);
    const manager = new ManageAssetOrganization({ chaincodeName, channelName });

    const payload = {
      orgId: params.orgId,
      schemaUrl: this.config.ledger?.schemaUrl,
      governanceVc: params.config.governanceVc,
      selfDescriptionVc: params.config.selfDescriptionVc,
      evidence: params.evidence,
      keys: params.config.didDocument?.verificationMethod,
      metadata: {
        role: params.role,
        sector: params.sector,
        namespace: this.config.namespace,
        host: this.config.hostExternalDomain,
        organization: params.organization?.meta?.claims?.[ClaimsOrganizationSchemaorg.alternateName],
      },
    };

    try {
      await manager.createOrganization(mspId, params.orgId, payload);
    } catch (error: any) {
      const message = String(error?.message || error);
      if (message.includes('EvidenceAlreadyRegistered')) {
        throw new ManagerError('Evidence already registered for another organization.', IssueType.Conflict);
      }
      if (message.includes('already exists')) {
        throw new ManagerError('Organization already registered on ledger.', IssueType.Conflict);
      }
      throw new ManagerError(`Ledger registration failed: ${message}`, IssueType.Exception);
    }
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
