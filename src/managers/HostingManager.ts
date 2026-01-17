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
import { composeHostDidWebId, createHostedDidWeb, populateDidDocumentFromJwks } from '../utils/did-backend';
import { populateDidDocumentServices } from '../utils/did-document';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../utils/services';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, isValidTenantAlternateName } from '../utils/tenant';
import { AllowedIndexableClaims } from '../gdc-backend-utils-node/models/indexing';
import { createOrganizationUrn } from '../utils/urn';
import { ILogger } from '../loggers/ILogger';
import { TenantsCacheManager } from './TenantsCacheManager';
import { generateLicenseOffer } from '../utils/offer';
import { VC_CONTEXT_V2, VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { EntityLifecycleStatus, EntityType, NetworkAccessStatus, NetworkName, BundleEntryType } from '../gdc-backend-utils-node/models/enums';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { VerificationMethod } from 'gdc-common-utils-ts/models/did';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool } from '../utils/license-issuance';

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
 *     network, and creates a provisional, host-signed `vc.json` to facilitate frontend development and testing.
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

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    storageAdapter: IStorageAdapter,
    logger: ILogger,
    config: IServerConfig,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.storageAdapter = storageAdapter;
    this.logger = logger;
    this.config = config;
  }

  public async bootstrapHost(hostClaims: ClaimsRecord): Promise<void> {
    const { organization, person, service } = this.extractResources(hostClaims);
    const processedService = await this._handleServiceAttachment(service);
    const allClaims = { ...hostClaims, ...(processedService?.meta.claims || {}) };
    await this.persistHostConfig(organization, allClaims, [person, processedService!]);
  }

  async process(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
    const issuerDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    
    try {
      switch (job.resourceType) {
        case 'Organization':
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
   * Handles Phase 1, Step 1: Provisional Registration.
   */
  private async processOrganizationRegistration(job: JobRequest, environment?: string, isBootstrap: boolean = false): Promise<IDecodedDidcommPayload> {
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
      sectionId: 'tenants',
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

    const { claims: processedClaims } = decryptedContent;
    const alternateName = processedClaims[ClaimsOrganizationSchemaorg.alternateName] as string;
    const sector = processedClaims[ClaimsServiceSchemaorg.category] as Sector;
    // Ensure the canonical tenant identifier URN exists for downstream managers (e.g., EmployeeManager issuer).
    const tenantUrn = createOrganizationUrn({
      namespace: this.config.namespace,
      network: 'test-network',
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector,
      idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = tenantUrn;

    const { organization, person, service } = this.extractResources(processedClaims, environment);

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
    await this.vaultRepository.put(hostCollectionName!, [secureFinalDoc], 'tenants');
    
    // Save VCs and other resources into the TENANT's own vault
    const vcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
    const secureVcDoc = await this.kmsService.protectConfidentialData(vcDoc, vaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureVcDoc, secureSelfDescDoc], '.well-known');

    const [legalRep, processedService] = [person, service];
    if (legalRep) {
      const email = legalRep.meta?.claims?.[ClaimsPersonSchemaorg.email] as string | undefined;
      const roleCode = legalRep.meta?.claims?.[ClaimsPersonSchemaorg.hasOccupation] as string | undefined;
      if (!email || !roleCode) {
        throw new ManagerError('Missing required admin Person claims (email, hasOccupation) during order finalization.', IssueType.Required);
      }

      const employeeUrn = `${tenantUrn}:employee:${email}:role:isco-08|${roleCode}`;

      const storedKeys = (decryptedContent as any)?.registrationKeys as
        | { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk }
        | undefined;

      let signerJwk = storedKeys?.signerJwk;
      let encrypterJwk = storedKeys?.encrypterJwk;
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

      const employeeConfig: EntityConfig = {
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

      const attributesToIndex: ParameterData[] = [
        { name: 'email', value: email, unique: true, type: 'string' },
        { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' },
        { name: 'kid', value: signerJwk.kid, unique: false, type: 'string' },
        { name: 'kid', value: encrypterJwk.kid, unique: false, type: 'string' },
      ];
      const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, vaultId);

      const employeeDoc: ConfidentialStorageDoc = {
        id: employeeConfig.id,
        status: employeeConfig.status,
        sequence: 0,
        content: employeeConfig,
        indexed: { attributes: protectedAttributes },
      };
      const secureEmployeeDoc = await this.kmsService.protectConfidentialData(employeeDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureEmployeeDoc], 'employees');
    }
	    if (processedService) {
	      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
	      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
	      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], 'services');
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
	      await this.vaultRepository.put(vaultId, licenseDocs, 'device-licenses');

        // Auto-issue the first activation code for the legal representative so they can register their first device
        // right after accepting/paying the Order (no manual "invite" step needed for the first controller).
        const legalRepEmail = processedClaims[ClaimsPersonSchemaorg.email] as string | undefined;
        const legalRepRole = processedClaims[ClaimsPersonSchemaorg.hasOccupation] as string | undefined;
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

	    return {
	      type: 'Organization',
	      resource: {
        ...organization,
        resourceType: 'Organization',
        meta: { ...organization.meta, claims: processedClaims },
        contained: [person, service],
      },
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
        // The client bootstraps its keys during the first request by providing:
        // - `jwk`: the public JWK *thumbprint material* (RFC 7638) WITHOUT `kid`/`use`
        // - `kid`: a key identifier in the JOSE header (often the JWK thumbprint, but treat it as opaque)
        // Persist the *full* public JWKs (including `kid`) so the legal representative can later be
        // represented as a DID subject.
        const signerKid = jobMeta?.jws?.protected?.kid as string | undefined;
        const signerAlg = jobMeta?.jws?.protected?.alg as string | undefined;
        const signerJwkThumbprintMaterial = jobMeta?.jws?.protected?.jwk as PublicJwk | undefined;
        const signerJwk: PublicJwk | undefined =
          signerJwkThumbprintMaterial && signerKid
            ? ({ ...signerJwkThumbprintMaterial, kid: signerKid, use: 'sig', ...(signerAlg ? { alg: signerAlg } : {}) } as any)
            : undefined;

        // In JWE, `kid` is the recipient's key id, while `skid` is the sender's key id.
        const encrypterKid = (jobMeta?.jwe?.header as any)?.skid as string | undefined;
        const encrypterJwkThumbprintMaterial = jobMeta?.jwe?.header?.jwk as PublicJwk | undefined;
        const encrypterJwk: PublicJwk | undefined =
          encrypterJwkThumbprintMaterial && encrypterKid
            ? ({ ...encrypterJwkThumbprintMaterial, kid: encrypterKid, use: 'enc' } as any)
            : undefined;

        const registrationKeys = { signerJwk, encrypterJwk };

        const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
        const jurisdiction = processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string;

        // Persist a canonical tenant identifier URN early (even while pending) so the cache/discovery can resolve it.
        const tenantUrn = createOrganizationUrn({
          namespace: this.config.namespace,
          network: 'test-network',
          jurisdiction,
          sector: validatedSector!,
          idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
          idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
        });
        (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = tenantUrn;

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
	            contained: [person, processedService],
	            ...(registrationKeys.signerJwk || registrationKeys.encrypterJwk ? { registrationKeys } : {}),
	          },
	        };

        const hostCollectionName = await this.tenantsCacheManager.getCollectionName('host');
        const secureTenantRegistrationDoc = await this.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
        await this.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], 'tenants');
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
    const didConfigServices = initializeHostServicesConfig(this.config.sectorsAllowed, this.config.nodeEnv);
    const baseUrl = this.config.apiBaseUrl;
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    didDocument.service = populateDidDocumentServices(didId, baseUrl, didConfigServices, false, {} as any);

    const hostConfig: OrganizationConfig = {
      id: org.id,
      type: EntityType.Organization,
      status: EntityLifecycleStatus.Active,
      claims: allClaims,
      didConfig: { service: didConfigServices },
      didDocument: didDocument,
      networkStatus: [], // Host does not participate in networks as a tenant.
      meta: { lastUpdated: new Date().toISOString() },
    };

    const docToProtect: ConfidentialStorageDoc = {
      id: logicalVaultId,
      status: hostConfig.status,
      sequence: 0,
      content: hostConfig,
    };

    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, logicalVaultId);
    await this.vaultRepository.put(hostCollectionName, [secureDoc], 'tenants');
    
    const [adminPerson, processedService] = contained;
    if (adminPerson) {
      const adminDoc: ConfidentialStorageDoc = { id: adminPerson.id, status: 'active', sequence: 0, content: adminPerson };
      const secureAdminDoc = await this.kmsService.protectConfidentialData(adminDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureAdminDoc], 'employees');
    }
    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, logicalVaultId);
      await this.vaultRepository.put(hostCollectionName, [secureServiceDoc], 'services');
    }
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
    await this.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], 'tenants');

    // Save VCs and other resources into the TENANT's own vault
    const vcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
    const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
    const secureVcDoc = await this.kmsService.protectConfidentialData(vcDoc, vaultId);
    const secureSelfDescDoc = await this.kmsService.protectConfidentialData(selfDescDoc, vaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureVcDoc, secureSelfDescDoc], '.well-known');

    const [legalRep, processedService] = contained;
    if (legalRep) {
      const legalRepDoc: ConfidentialStorageDoc = { id: legalRep.id, status: 'active', sequence: 0, content: legalRep };
      const secureLegalRepDoc = await this.kmsService.protectConfidentialData(legalRepDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureLegalRepDoc], 'employees');
    }
    if (processedService) {
      const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
      const secureServiceDoc = await this.kmsService.protectConfidentialData(serviceDoc, vaultId);
      await this.vaultRepository.put(tenantCollectionName, [secureServiceDoc], 'services');
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
      namespace: this.config.namespace, network: 'test-network',
      jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      sector: sector, idType: allClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: allClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const context = { jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector: sector };
    const hostedDid = createHostedDidWeb(hostDid, altName, context);
    const publicTenantUrl = allClaims[ClaimsOrganizationSchemaorg.url] as string | undefined;
    const externalDid = publicTenantUrl && publicTenantUrl.startsWith('https://') ? `did:web:${new URL(publicTenantUrl).hostname}` : undefined;
    const primaryDid = externalDid || hostedDid;
    const alsoKnownAs = [tenantUrn, ...(externalDid && primaryDid !== externalDid ? [externalDid] : []), ...(hostedDid && primaryDid !== hostedDid ? [hostedDid] : [])];
    const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: primaryDid, alsoKnownAs: alsoKnownAs };
    const didConfigServices = initializeTenantServicesConfig(sector);
    const isHosted = !publicTenantUrl?.startsWith('https://');
    const baseUrl = isHosted ? this.config.apiBaseUrl : publicTenantUrl!;
    const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
    const tenantContext = { alternateName: altName, jurisdiction: allClaims[ClaimsOrganizationSchemaorg.addressCountry] as string, version: 'v1', sector };
    didDocument.service = populateDidDocumentServices(primaryDid, baseUrl, didConfigServices, isHosted, tenantContext);
    
    // 3. Create provisional, host-signed vc.json for test/demo purposes
    const hostSignerKid = (await this.kmsService.getPublicJwks('host')).keys.find(k => k.use === 'sig')?.kid;
    if (!hostSignerKid) {
      throw new ManagerError('Host signing key not found, cannot issue provisional VC.', IssueType.Exception);
    }
    const governanceVcPayload: Omit<VerifiableCredentialV2, 'proof'> = {
      '@context': [VC_CONTEXT_V2],
      type: ['VerifiableCredential', 'GaiaxCredential'],
      id: `urn:uuid:${uuidv4()}`,
      issuer: hostDid,
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: primaryDid,
        ...allClaims,
      },
    };
    const govDetachedJws = await this.kmsService.createDetachedJws(governanceVcPayload, hostSignerKid, 'host');
    const governanceVc: VerifiableCredentialV2 = {
        ...governanceVcPayload,
        proof: [{
            type: 'JsonWebSignature2020',
            created: new Date().toISOString(),
            proofPurpose: 'assertionMethod',
            verificationMethod: `${hostDid}#${hostSignerKid}`,
            jws: govDetachedJws,
        }]
    };

    // 4. Create self-signed self-description.json
    const tenantSignerKid = publicKeys.keys.find(k => k.use === 'sig')?.kid;
    if (!tenantSignerKid) {
      throw new ManagerError('Tenant signing key not found, cannot issue self-description.', IssueType.Exception);
    }
    const selfDescriptionPayload: Omit<VerifiableCredentialV2, 'proof'> = { ...governanceVcPayload, issuer: primaryDid };
    const selfDescDetachedJws = await this.kmsService.createDetachedJws(selfDescriptionPayload, tenantSignerKid, vaultId);
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
          networkName: NetworkName.Test, // Grant initial access to the test network
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
      meta: { lastUpdated: new Date().toISOString() },
    };
    
    return tenantConfig;
  }


  private async _handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    if (!service) return undefined;
    let termsOfService = service.meta.claims[ClaimsServiceSchemaorg.termsOfService] as string | undefined;

    if (termsOfService && !termsOfService.startsWith('http')) {
      try {
        if (termsOfService.startsWith('data:')) {
          const parts = termsOfService.split(',');
          if (parts.length !== 2) { throw new Error('Malformed data URL.'); }
          termsOfService = parts[1];
        }
        const pdfBytes = Buffer.from(termsOfService, 'base64');
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
    // console.log('--- DEBUG: Extracted resources ---', JSON.stringify(resources, null, 2));
    if (!resources.organization || !resources.person || !resources.service) {
      throw new ManagerError('Incomplete claims: Organization, Person, and Service resources are required.', IssueType.Required);
    }
    return resources as { organization: IncludedResource; person: IncludedResource; service: IncludedResource };
  }
}
