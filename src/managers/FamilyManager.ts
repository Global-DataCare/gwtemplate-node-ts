// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/FamilyManager.ts

import { v4 as uuidv4 } from 'uuid';
import { IServerConfig } from '../config';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { ILogger } from '../loggers/ILogger';
import { BundleEntry, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { TenantsCacheManager } from './TenantsCacheManager';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool } from '../utils/license-issuance';
import { buildPaymentCommunication, readOfferPaymentContext } from '../utils/order-communication';
import { getPersonOccupationClaim } from '../utils/occupation';
import { buildClaimsFromIndividualRegistrationPdfAttachment } from '../utils/individual-registration-pdf-attachment';
import {
  ACTION_DISABLE,
  ACTION_PURGE,
  LICENSE_CATEGORY_INDIVIDUAL,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_TYPE_MOBILE,
  LICENSE_USER_CLASS_CUSTOMER,
  LICENSE_USER_CLASS_INDIVIDUAL,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';

type FamilyRegistrationContent = {
  status: EntityLifecycleStatus;
  claims: ClaimsRecord;
  contained: IncludedResource[];
};

const INDIVIDUAL_SECTION = getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL);
const DEVICE_LICENSE_SECTION = getEnvSectionId('device-licenses');

export class FamilyManager {
  constructor(
    private vaultRepository: IVaultRepository,
    private kmsService: IKmsService,
    private tenantsCacheManager: TenantsCacheManager,
    private storageAdapter: IStorageAdapter,
    private logger: ILogger,
    private config: IServerConfig,
  ) {}

  async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    try {
      for (const entry of jobEntries) {
        try {
          if (job.action === '_search' && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilySearchEntry(job, entry, environment));
          } else if (job.action === ACTION_DISABLE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyDisableEntry(job, entry));
          } else if (job.action === ACTION_PURGE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyPurgeEntry(job, entry));
          } else if (job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyRegistrationEntry(job, entry, environment));
          } else if (job.resourceType === 'Order') {
            responseEntries.push(await this.processFamilyOrderEntry(job, entry, environment));
          } else {
            throw new ManagerError(`Unsupported resourceType for family flow: '${job.resourceType}'`, IssueType.NotSupported);
          }
        } catch (error: any) {
          responseEntries.push(this.handleError(error, entry.type, entry.meta));
        }
      }
    } catch (error: any) {
      const entryType = jobEntries[0]?.type || job.resourceType || 'unknown';
      responseEntries.push(this.handleError(error, entryType));
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    return {
      jti: uuidv4(),
      type: 'family-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  private async processFamilyRegistrationEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const entryType = entry.type || 'Family-registration-form-v1.0';
    const rawClaims = entry?.meta?.claims;
    const attachmentClaims = await this.resolveIndividualRegistrationAttachmentClaims(job);
    const mergedClaims = {
      ...((rawClaims && typeof rawClaims === 'object') ? rawClaims : {}),
      ...(attachmentClaims || {}),
    };
    const claims: ClaimsRecord | undefined = Object.keys(mergedClaims).length > 0
      ? (normalizeContextualizedClaims(mergedClaims) as ClaimsRecord)
      : undefined;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = claims[ClaimsServiceSchemaorg.category] as Sector | undefined;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }

    const tenantId = job.tenantId;
    if (!tenantId) {
      throw new ManagerError('Job is missing tenantId.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(requestedSector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const { organization, person, service } = this.extractResources(claims, environment);
    const processedService = await this.handleServiceAttachment(service);

    // Individual org attributes live in Organization claims.
    const ownerPhonesRaw = claims['org.schema.Organization.owner.telephone'] as string | undefined;
    const ownerEmailsRaw = claims['org.schema.Organization.owner.email'] as string | undefined;
    const ownerPhones = ownerPhonesRaw ? ownerPhonesRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
    const ownerEmails = ownerEmailsRaw ? ownerEmailsRaw.split(',').map(e => e.trim()).filter(Boolean) : [];
    const apodo = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if (!apodo || (ownerPhones.length === 0 && ownerEmails.length === 0)) {
      throw new ManagerError(
        `Missing required claims: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    // Idempotency: owner+alternateName must be unique.
    for (const phone of ownerPhones) {
        const existing = await this.vaultRepository.query(tenantCollectionName, {
          sectionId: INDIVIDUAL_SECTION,
          where: [
            { name: 'org.schema.Organization.owner.telephone', value: phone },
            { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
          ],
        });
        if (existing.length > 0) {
          const secureExisting = existing[0] as ConfidentialStorageDoc;
          const existingContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureExisting, tenantVaultId);
          const regStatus = existingContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';
          return {
            type: 'Family-registration-offer-v1.0',
            meta: {
              claims: {
                ...(existingContent?.claims || {}),
                'org.schema.FamilyRegistration.status': regStatus,
              },
            },
            resource: { resourceType: 'Organization', id: secureExisting.id },
            response: { status: '200' },
          };
      }
    }
    for (const email of ownerEmails) {
      const existing = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.email', value: email },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
        ],
      });
      if (existing.length > 0) {
        const secureExisting = existing[0] as ConfidentialStorageDoc;
        const existingContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureExisting, tenantVaultId);
        const regStatus = existingContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';
        return {
          type: 'Family-registration-offer-v1.0',
          meta: {
            claims: {
              ...(existingContent?.claims || {}),
              'org.schema.FamilyRegistration.status': regStatus,
            },
          },
          resource: { resourceType: 'Organization', id: secureExisting.id },
          response: { status: '200' },
        };
      }
    }

    // Offer generation: default to 2 (representative + subject).
    const jurisdiction = claims[ClaimsOrganizationSchemaorg.addressCountry] as string;
    const offeredBy = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!offeredBy) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const offerClaims = generateLicenseOffer(
      2,
      offeredBy,
      jurisdiction,
      requestedSector,
      this.config.allowedPaymentMethods,
      LICENSE_CATEGORY_INDIVIDUAL,
    );

    const processedClaims: ClaimsRecord = {
      ...claims,
      ...(processedService?.meta.claims || {}),
      ...offerClaims,
      '@type': 'receipt',
    };

    const familyDocId =
      (processedClaims[`${ClaimsOrganizationSchemaorg.identifierValue}`] as string | undefined) || uuidv4();

    const indexedPhones = ownerPhones.map(phone => ({ name: 'org.schema.Organization.owner.telephone', value: phone }));
    const indexedEmails = ownerEmails.map(email => ({ name: 'org.schema.Organization.owner.email', value: email }));

    const individualDocId =
      (processedClaims[`${ClaimsOrganizationSchemaorg.identifierValue}`] as string | undefined) || uuidv4();

    const registrationDoc: ConfidentialStorageDoc = {
      id: individualDocId,
      status: EntityLifecycleStatus.Pending,
      sequence: 0,
      indexed: {
        attributes: [
          { name: 'status', value: EntityLifecycleStatus.Pending },
          { name: ClaimsOfferSchemaorg.identifier, value: processedClaims[ClaimsOfferSchemaorg.identifier] as string, unique: true },
          ...indexedPhones,
          ...indexedEmails,
          ...(apodo ? [{ name: ClaimsOrganizationSchemaorg.alternateName, value: apodo }] : []),
        ],
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: {
        status: EntityLifecycleStatus.Pending,
        claims: processedClaims,
        contained: [person, processedService].filter(Boolean) as IncludedResource[],
      } satisfies FamilyRegistrationContent,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(registrationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureDoc], INDIVIDUAL_SECTION);

    return {
      type: 'Family-registration-offer-v1.0',
      meta: { claims: { ...processedClaims, 'org.schema.FamilyRegistration.status': 'new_created' } },
      resource: { resourceType: 'Organization', id: familyDocId },
      response: { status: '201' },
    };
  }

  private async resolveIndividualRegistrationAttachmentClaims(job: JobRequest): Promise<ClaimsRecord | undefined> {
    const decodedContent = job.content as Record<string, any> | undefined;
    const attachmentResult = await buildClaimsFromIndividualRegistrationPdfAttachment(
      decodedContent?.attachments || decodedContent?.body?.attachments,
    );
    if (!attachmentResult) return undefined;
    return attachmentResult.claims as ClaimsRecord;
  }

  private async processFamilyOrderEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const entryType = entry.type || 'Family-order-request-v1.0';
    const rawClaims = entry?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed order entry: missing meta.claims', IssueType.Required);
    }

    const offerId = getClaimValue<string>(claims, 'Order.acceptedOffer.identifier');
    if (!offerId) {
      throw new ManagerError(`Missing required claim in Order: 'Order.acceptedOffer.identifier'`, IssueType.Required);
    }

    const tenantId = job.tenantId;
    const sector = job.sector as Sector | undefined;
    if (!tenantId || !sector) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const results = await this.vaultRepository.query(tenantCollectionName, {
      sectionId: INDIVIDUAL_SECTION,
      where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
    });

    if (results.length === 0) {
      throw new ManagerError(`No pending family registration found for offerId: '${offerId}'`, IssueType.NotFound);
    }
    if (results.length > 1) {
      this.logger.error(`CRITICAL: Multiple pending family registrations found for the same offerId: '${offerId}'`);
      throw new ManagerError('Internal system conflict. Multiple pending registrations found.', IssueType.Conflict);
    }

    const secureDoc = results[0] as ConfidentialStorageDoc;
    const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureDoc, tenantVaultId);
    if (decryptedContent?.status !== EntityLifecycleStatus.Pending) {
      throw new ManagerError(`Found family registration for offerId '${offerId}', but it is not in 'pending' state.`, IssueType.Conflict);
    }

    const finalizedContent: FamilyRegistrationContent = {
      ...decryptedContent,
      status: EntityLifecycleStatus.Active,
    };

    const updatedDoc: ConfidentialStorageDoc = {
      id: secureDoc.id,
      status: finalizedContent.status,
      sequence: (secureDoc.sequence || 0) + 1,
      indexed: secureDoc.indexed,
      content: finalizedContent,
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], INDIVIDUAL_SECTION);

    // Create individual (family member) license seats purchased via the family registration Offer and auto-issue one for the controller.
    const familySeats = finalizedContent.claims[ClaimsOfferSchemaorg.eligibleQuantityValue] as number | undefined;
    const familyOfferIdentifier = finalizedContent.claims[ClaimsOfferSchemaorg.identifier] as string | undefined;
    if (familySeats && familySeats > 0 && familyOfferIdentifier) {
      const now = Date.now();
      const expiryDate = new Date(now);
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      const exp = Math.floor(expiryDate.getTime() / 1000);

      const licenseDocs: ConfidentialStorageDoc[] = [];
      for (let i = 0; i < familySeats; i++) {
        const licenseId = uuidv4();
        const license: DeviceLicense = {
          id: licenseId,
          tenantId,
          orderId: familyOfferIdentifier,
          userClass: LICENSE_USER_CLASS_INDIVIDUAL,
          type: LICENSE_TYPE_MOBILE,
          status: LICENSE_STATUS_AVAILABLE,
          plan: 'default',
          renewalCycle: '12m',
          reactivationEnabled: false,
          exp,
        } as any;
        licenseDocs.push({ id: licenseId, status: license.status, sequence: 0, content: license });
      }
      await this.vaultRepository.put(tenantVaultId, licenseDocs, DEVICE_LICENSE_SECTION);

      const controllerEmail = finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined;
      const controllerPhoneForActivation = finalizedContent.claims[ClaimsPersonSchemaorg.telephone] as string | undefined;
      const controllerContact = controllerEmail || controllerPhoneForActivation;
      const controllerRole = getPersonOccupationClaim(finalizedContent.claims as Record<string, any> | undefined) || 'FAMILY_CONTROLLER';
      if (controllerContact) {
        try {
          const { activationCode } = await issueActivationCodeFromPool({
            vaultRepository: this.vaultRepository,
            kmsService: this.kmsService,
            tenantVaultId,
            userClass: LICENSE_USER_CLASS_INDIVIDUAL,
            type: LICENSE_TYPE_MOBILE,
            email: controllerContact,
            role: controllerRole,
          });
          (finalizedContent.claims as any)['org.schema.IndividualProduct.serialNumber'] = activationCode;
          (finalizedContent.claims as any)['org.schema.IndividualProduct.category'] = LICENSE_CATEGORY_INDIVIDUAL;
        } catch (e: any) {
          this.logger.warn?.(`[FamilyManager] Failed to auto-issue family controller activation code: ${String(e?.message || e)}`);
        }
      }
    }

    const tenantDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!tenantDid) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const recipientDid = job.content?.iss || tenantDid;
    const paymentContext = {
      offerId,
      tenantId,
      tenantDid: recipientDid,
      senderDid: tenantDid,
      email: finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined,
      legalName: finalizedContent.claims[ClaimsOrganizationSchemaorg.legalName] as string | undefined,
      addressCountry: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined,
      addressRegion: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressRegion] as string | undefined,
      addressLocality: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressLocality] as string | undefined,
      postalCode: finalizedContent.claims[ClaimsOrganizationSchemaorg.postalCode] as string | undefined,
      streetAddress: finalizedContent.claims[ClaimsOrganizationSchemaorg.streetAddress] as string | undefined,
      activationCode: (finalizedContent.claims as any)['org.schema.IndividualProduct.serialNumber'] as string | undefined,
      activationCategory: (finalizedContent.claims as any)['org.schema.IndividualProduct.category'] as string | undefined,
      ...readOfferPaymentContext(finalizedContent.claims),
    };
    const paymentCommunication = await buildPaymentCommunication(paymentContext);

    const communicationDoc: ConfidentialStorageDoc = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: { claims: paymentCommunication.claims },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Family-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
      response: { status: '201' },
    };
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    }
    this.logger.error('Unexpected error during family processing:', error);
    return {
      type: entryType,
      meta,
      response: {
        status: '500',
        outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
      },
    };
  }

  private async processFamilySearchEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const ownerPhoneRaw = claims['org.schema.Organization.owner.telephone'] as string | undefined;
    const ownerEmailRaw = claims['org.schema.Organization.owner.email'] as string | undefined;
    const ownerPhones = ownerPhoneRaw ? ownerPhoneRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
    const ownerEmails = ownerEmailRaw ? ownerEmailRaw.split(',').map(e => e.trim()).filter(Boolean) : [];
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if ((ownerPhones.length === 0 && ownerEmails.length === 0) || !nickname) {
      throw new ManagerError(
        `Missing required claims for search: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const foundResult = await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname);

    if (!foundResult) {
      return {
        type: 'Family-search-result-v1.0',
        meta: {
          claims: {
            'org.schema.FamilyRegistration.status': 'not_found',
            [ClaimsOrganizationSchemaorg.alternateName]: nickname,
          },
        },
        response: { status: '200' },
      };
    }

    const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    const regStatus = decryptedContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';

    return {
      type: 'Family-search-result-v1.0',
      meta: {
        claims: {
          ...decryptedContent?.claims,
          'org.schema.FamilyRegistration.status': regStatus,
        },
      },
      resource: { resourceType: 'Organization', id: foundResult.id },
      response: { status: '200' },
    };
  }

  private async processFamilyPurgeEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const ownerPhoneRaw = claims['org.schema.Organization.owner.telephone'] as string | undefined;
    const ownerEmailRaw = claims['org.schema.Organization.owner.email'] as string | undefined;
    const ownerPhones = ownerPhoneRaw ? ownerPhoneRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
    const ownerEmails = ownerEmailRaw ? ownerEmailRaw.split(',').map(e => e.trim()).filter(Boolean) : [];
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if ((ownerPhones.length === 0 && ownerEmails.length === 0) || !nickname) {
      throw new ManagerError(
        `Missing required claims for purge: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const foundResult = await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname);
    if (!foundResult) {
      throw new ManagerError('Family registration not found for purge.', IssueType.NotFound);
    }

    const familyContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    if (familyContent.status !== EntityLifecycleStatus.Inactive) {
      throw new ManagerError('Family registration must be disabled before purge.', IssueType.Conflict);
    }

    await this.releaseFamilyLicenses(tenantVaultId, familyContent);

    const updatedContent: FamilyRegistrationContent = {
      ...familyContent,
      status: EntityLifecycleStatus.Inactive,
      claims: {
        ...familyContent.claims,
        'org.schema.FamilyRegistration.status': 'purged',
      } as ClaimsRecord,
    };
    const updatedDoc: ConfidentialStorageDoc = {
      ...foundResult,
      status: EntityLifecycleStatus.Inactive,
      sequence: (foundResult.sequence || 0) + 1,
      content: updatedContent,
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], INDIVIDUAL_SECTION);

    return {
      type: 'Family-purge-response-v1.0',
      meta: {
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: nickname,
          'org.schema.FamilyRegistration.status': 'purged',
        },
      },
      resource: { resourceType: 'Organization', id: foundResult.id },
      response: { status: '200' },
    };
  }

  private async processFamilyDisableEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const ownerPhoneRaw = claims['org.schema.Organization.owner.telephone'] as string | undefined;
    const ownerEmailRaw = claims['org.schema.Organization.owner.email'] as string | undefined;
    const ownerPhones = ownerPhoneRaw ? ownerPhoneRaw.split(',').map(p => p.trim()).filter(Boolean) : [];
    const ownerEmails = ownerEmailRaw ? ownerEmailRaw.split(',').map(e => e.trim()).filter(Boolean) : [];
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if ((ownerPhones.length === 0 && ownerEmails.length === 0) || !nickname) {
      throw new ManagerError(
        `Missing required claims for disable: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const foundResult = await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname);
    if (!foundResult) {
      throw new ManagerError('Family registration not found for disable.', IssueType.NotFound);
    }

    const familyContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    familyContent.status = EntityLifecycleStatus.Inactive;
    const updatedDoc: ConfidentialStorageDoc = {
      ...foundResult,
      status: EntityLifecycleStatus.Inactive,
      sequence: (foundResult.sequence || 0) + 1,
      content: familyContent,
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], INDIVIDUAL_SECTION);

    return {
      type: 'Family-disable-response-v1.0',
      meta: {
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: nickname,
          'org.schema.FamilyRegistration.status': 'disabled',
        },
      },
      resource: { resourceType: 'Organization', id: foundResult.id },
      response: { status: '200' },
    };
  }

  private async releaseFamilyLicenses(
    tenantVaultId: string,
    familyContent: FamilyRegistrationContent,
  ): Promise<void> {
    const activationCode = String((familyContent.claims as any)['org.schema.IndividualProduct.serialNumber'] || '').trim();
    const email = String(
      familyContent.claims[ClaimsPersonSchemaorg.email]
      || familyContent.claims[ClaimsOrganizationSchemaorg.ownerEmail]
      || '',
    ).trim().toLowerCase();

    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(tenantVaultId, DEVICE_LICENSE_SECTION)) || [];
    const updatedDocs: ConfidentialStorageDoc[] = [];

    for (const doc of licenseDocs) {
      const license = doc.content as (DeviceLicense & Record<string, any>) | undefined;
      const userClass = String(license?.userClass || '');
      if (!license || (userClass !== LICENSE_USER_CLASS_INDIVIDUAL && userClass !== LICENSE_USER_CLASS_CUSTOMER)) {
        continue;
      }

      const matchesActivationCode = activationCode && String(license.activationCode || '').trim() === activationCode;
      const matchesInviteEmail = email && String(license.issuedToEmail || '').trim().toLowerCase() === email;
      if (!matchesActivationCode && !matchesInviteEmail) {
        continue;
      }

      const resetLicense: DeviceLicense & Record<string, any> = {
        ...license,
        status: LICENSE_STATUS_AVAILABLE,
      };
      delete resetLicense.subjectId;
      delete resetLicense.activationCode;
      delete resetLicense.issuedAt;
      delete resetLicense.issuedToEmail;
      delete resetLicense.issuedToRole;
      delete resetLicense.activatedAt;
      delete resetLicense.deviceId;
      delete resetLicense.deviceInfo;

      updatedDocs.push({
        ...doc,
        status: LICENSE_STATUS_AVAILABLE,
        sequence: (doc.sequence || 0) + 1,
        content: resetLicense,
      });
    }

    if (updatedDocs.length > 0) {
      await this.vaultRepository.put(tenantVaultId, updatedDocs, DEVICE_LICENSE_SECTION);
    }
  }

  private async findFamilyRegistrationDoc(
    tenantCollectionName: string,
    ownerPhones: string[],
    ownerEmails: string[],
    nickname: string,
  ): Promise<ConfidentialStorageDoc | undefined> {
    for (const phone of ownerPhones) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.telephone', value: phone },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: nickname },
        ],
      });
      if (results.length > 0) {
        return results[0] as ConfidentialStorageDoc;
      }
    }
    for (const email of ownerEmails) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.email', value: email },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: nickname },
        ],
      });
      if (results.length > 0) {
        return results[0] as ConfidentialStorageDoc;
      }
    }
    return undefined;
  }

  private async handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    if (!service) return undefined;
    let termsOfService = service.meta.claims[ClaimsServiceSchemaorg.termsOfService] as string | undefined;
    if (termsOfService && !termsOfService.startsWith('http')) {
      try {
        if (termsOfService.startsWith('data:')) {
          const parts = termsOfService.split(',');
          if (parts.length !== 2) throw new Error('Malformed data URL.');
          termsOfService = parts[1];
        }
        const pdfBytes = Buffer.from(termsOfService, 'base64');
        const uploadResult = await this.storageAdapter.upload(pdfBytes, 'application/pdf');
        if (!uploadResult) throw new Error('Storage adapter returned undefined result.');
        const { publicUrl, encodedMultiHash } = uploadResult;
        service.meta.claims[ClaimsServiceSchemaorg.termsOfService] = publicUrl;
        (service.meta.claims as any)[`${ClaimsServiceSchemaorg.termsOfService}#hash`] = encodedMultiHash;
      } catch (e: any) {
        throw new ManagerError(`Error processing service attachment: ${e.message}`, IssueType.Invalid);
      }
    }
    return service;
  }

  private extractResources(claims: ClaimsRecord, environment?: string) {
    const resourceTypes = ['Organization', 'Person', 'Service'] as const;
    const resources: Record<string, IncludedResource> = {};

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
          type,
          meta: { claims: resourceClaims },
        } as IncludedResource;
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
