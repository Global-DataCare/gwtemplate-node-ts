// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/FamilyManager.ts
import { createHash } from 'crypto';

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
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { formatMissingRequiredClaimDiagnostic, toExternalClaimLabel } from '../utils/claim-contract';
import {
  buildOfferOrderIndexedAttributes,
  buildOfferOrderSearchRow,
  extractOfferOrderSearchClaims,
  matchOfferOrderSearchClaims,
  readProjectedOfferOrderClaims,
} from '../utils/offer-order-read-model';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import type { ITenantsManager } from './ITenantsManager';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool } from '../utils/license-issuance';
import { buildPaymentCommunication, readOfferPaymentContext } from '../utils/order-communication';
import { buildGatewayInvoiceBundle } from '../utils/invoice-bundle';
import { verifyOrderPaymentConfirmation } from '../utils/payment-confirmation';
import { getPersonOccupationClaim } from '../utils/occupation';
import { buildClaimsFromIndividualRegistrationPdfAttachment } from '../utils/individual-registration-pdf-attachment';
import { buildClaimsFromIndividualOrganizationKyc } from '../utils/individual-organization-kyc';
import { buildIndividualOnboardingPdfDraftResponse } from '../utils/individual-onboarding-pdf-draft';
import { normalizeIndexedEmail, splitIndexedEmails, splitIndexedPhones } from '../utils/indexed-contact';
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
const TENANT_DISABLED_HOSTED_INDIVIDUAL_MESSAGE =
  'Tenant disabled must not allow creating a new hosted individual.';

export class FamilyManager {
  constructor(
    private vaultRepository: IVaultRepository,
    private kmsService: IKmsService,
    private tenantsCacheManager: ITenantsManager,
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
          } else if (job.action === '_search' && job.resourceType === 'Offer') {
            responseEntries.push(await this.processFamilyOfferSearchEntry(job, entry));
          } else if (job.action === '_search' && job.resourceType === 'Order') {
            responseEntries.push(await this.processFamilyOrderSearchEntry(job, entry));
          } else if (job.action === ACTION_DISABLE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyDisableEntry(job, entry));
          } else if (job.action === ACTION_PURGE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyPurgeEntry(job, entry));
          } else if (job.resourceType === 'DocumentReference' || job.resourceType === 'Action') {
            responseEntries.push(await this.processIndividualOnboardingPdfDraftEntry(job, entry));
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

  /**
   * Rejects hosted individual onboarding when the parent tenant is not
   * operational.
   *
   * Why this guard lives here:
   * - individual section `Organization` jobs are routed to `FamilyManager`, not
   *   `HostingManager`
   * - the live lifecycle contract expects a disabled tenant to reject new
   *   hosted individual creation immediately
   *
   * Why this uses `ITenantsManager` only:
   * - the onboarding flow needs only the derived operational state
   * - it must not load or decrypt the full tenant registration object
   */
  private async assertTenantAllowsHostedIndividualCreation(tenantVaultId: string): Promise<void> {
    const isTenantOperational = await this.tenantsCacheManager.isTenantOperational(tenantVaultId);
    if (!isTenantOperational) {
      throw new ManagerError(TENANT_DISABLED_HOSTED_INDIVIDUAL_MESSAGE, IssueType.Forbidden);
    }
  }

  private async processFamilyOfferSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry> {
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

    const filters = extractOfferOrderSearchClaims(entry);
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const records = where.length > 0
      ? [
        ...await this.vaultRepository.query(tenantCollectionName, { sectionId: INDIVIDUAL_SECTION, where }, { hydrate: false }),
        ...await this.vaultRepository.query(tenantCollectionName, { sectionId: getEnvSectionId('communications'), where }, { hydrate: false }),
      ]
      : [
        ...await this.vaultRepository.listContainersInSection(tenantCollectionName, INDIVIDUAL_SECTION),
        ...await this.vaultRepository.listContainersInSection(tenantCollectionName, getEnvSectionId('communications')),
      ];
    const matches: Record<string, unknown>[] = [];
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const claims = readProjectedOfferOrderClaims(secureDoc);
      if (!claims[ClaimsOfferSchemaorg.identifier]) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      matches.push(buildOfferOrderSearchRow(
        secureDoc,
        claims,
        ClaimsOfferSchemaorg.identifier,
      ));
    }

    return {
      type: 'Offer-search-response-v1.0',
      resource: { total: matches.length, data: matches } as any,
      response: { status: '200' },
    };
  }

  private async processFamilyOrderSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry> {
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

    const filters = extractOfferOrderSearchClaims(entry);
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const records = where.length > 0
      ? await this.vaultRepository.query(
        tenantCollectionName,
        { sectionId: getEnvSectionId('communications'), where },
        { hydrate: false },
      )
      : await this.vaultRepository.listContainersInSection(tenantCollectionName, getEnvSectionId('communications'));
    const matches: Record<string, unknown>[] = [];
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const claims = readProjectedOfferOrderClaims(secureDoc);
      if (!claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      matches.push(buildOfferOrderSearchRow(
        secureDoc,
        claims,
        ClaimsOrderSchemaorg.acceptedOfferIdentifier,
      ));
    }

    return {
      type: 'Order-search-response-v1.0',
      resource: { total: matches.length, data: matches } as any,
      response: { status: '200' },
    };
  }

  private async processFamilyRegistrationEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const entryType = entry.type || 'Family-registration-form-v1.0';
    const rawClaims = entry?.meta?.claims;
    const rawClaimsObject = (rawClaims && typeof rawClaims === 'object') ? rawClaims as Record<string, unknown> : {};
    const normalizedRawClaims: ClaimsRecord | undefined = Object.keys(rawClaimsObject).length > 0
      ? (normalizeContextualizedClaims(rawClaimsObject) as ClaimsRecord)
      : undefined;
    const attachmentClaims = await this.resolveIndividualRegistrationAttachmentClaims(job);
    const kycClaims = this.resolveIndividualRegistrationKycClaims(entry, normalizedRawClaims, attachmentClaims);
    const mergedClaims = {
      ...rawClaimsObject,
      ...(kycClaims || {}),
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
    await this.assertTenantAllowsHostedIndividualCreation(tenantVaultId);

    const { organization, person, service } = this.extractResources(claims, environment);
    const processedService = await this.handleServiceAttachment(service);

    // Individual org attributes live in Organization claims.
    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
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
    // This jurisdiction is the data-space/blockchain network selected by the
    // `cds-<jurisdiction>` route. It is not the individual's country and must
    // therefore come from the preserved HTTP route context, not from optional
    // Organization address claims.
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!jurisdiction) {
      throw new ManagerError('Job is missing route jurisdiction for the individual Offer network.', IssueType.Required);
    }
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

    const registrationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: individualDocId,
      status: EntityLifecycleStatus.Pending,
      sequence: 0,
      meta: { claims: processedClaims },
      indexed: {
        attributes: [
          { name: 'status', value: EntityLifecycleStatus.Pending },
          { name: ClaimsOfferSchemaorg.identifier, value: processedClaims[ClaimsOfferSchemaorg.identifier] as string, unique: true },
          ...indexedPhones,
          ...indexedEmails,
          ...(apodo ? [{ name: ClaimsOrganizationSchemaorg.alternateName, value: apodo }] : []),
          ...buildOfferOrderIndexedAttributes(processedClaims),
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

  private async processIndividualOnboardingPdfDraftEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    if (job.action !== '_create') {
      throw new ManagerError(`Unsupported family Action operation: '${job.action}'`, IssueType.NotSupported);
    }

    const entryResourceMeta = (entry?.resource?.meta && typeof entry.resource.meta === 'object')
      ? entry.resource.meta as Record<string, unknown>
      : {};
    const entryClaims = (entryResourceMeta.claims && typeof entryResourceMeta.claims === 'object')
      ? entryResourceMeta.claims as Record<string, unknown>
      : {};
    const template = entryResourceMeta.template as any;
    const formFields = entryResourceMeta.formFields as any;
    const kyc = entryResourceMeta.kyc as any;
    const subjectDid = String(
      entryClaims[ClaimsOrganizationSchemaorg.identifier]
      || entryClaims[ClaimsPersonSchemaorg.identifier]
      || entryClaims[ClaimsServiceSchemaorg.identifier]
      || '',
    ).trim();

    if (!subjectDid) {
      throw new ManagerError(
        `Individual onboarding PDF draft requires one subject identifier claim such as '${ClaimsOrganizationSchemaorg.identifier}'.`,
        IssueType.Required,
      );
    }

    const documentReferenceEntry = await buildIndividualOnboardingPdfDraftResponse(
      {
        template,
        formFields,
        kyc,
        claims: entryClaims,
      },
      subjectDid,
      String(entry?.resource?.id || '').trim() || undefined,
    );

    return {
      type: documentReferenceEntry.type,
      resource: documentReferenceEntry.resource as any,
      response: { status: '200' },
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

  private resolveIndividualRegistrationEntryMeta(entry: BundleEntry): Record<string, unknown> | undefined {
    const entryMeta = entry?.meta;
    const resourceMeta = (entry?.resource as Record<string, unknown> | undefined)?.meta;
    const normalizedEntryMeta = (entryMeta && typeof entryMeta === 'object') ? entryMeta as Record<string, unknown> : undefined;
    const normalizedResourceMeta = (resourceMeta && typeof resourceMeta === 'object') ? resourceMeta as Record<string, unknown> : undefined;

    if (!normalizedEntryMeta && !normalizedResourceMeta) return undefined;
    return {
      ...(normalizedResourceMeta || {}),
      ...(normalizedEntryMeta || {}),
    };
  }

  private resolveIndividualRegistrationKycClaims(
    entry: BundleEntry,
    normalizedRawClaims?: ClaimsRecord,
    attachmentClaims?: ClaimsRecord,
  ): ClaimsRecord | undefined {
    const meta = this.resolveIndividualRegistrationEntryMeta(entry);
    if (!meta) return undefined;

    const extensions = (meta.extensions && typeof meta.extensions === 'object')
      ? meta.extensions as Record<string, unknown>
      : undefined;
    const rawKyc = meta.kyc ?? extensions?.kyc;
    if (!rawKyc || typeof rawKyc !== 'object') return undefined;

    const kycPayload = rawKyc as Record<string, unknown>;
    const profile = (kycPayload.profile && typeof kycPayload.profile === 'object')
      ? kycPayload.profile as Record<string, unknown>
      : kycPayload;
    if (!profile || Object.keys(profile).length === 0) return undefined;

    const fallbackClaims = attachmentClaims || normalizedRawClaims;
    const individualAlternateName =
      (typeof kycPayload.individualAlternateName === 'string' ? kycPayload.individualAlternateName : undefined) ||
      (fallbackClaims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined);
    const individualBirthDate =
      (typeof kycPayload.individualBirthDate === 'string' ? kycPayload.individualBirthDate : undefined) ||
      (fallbackClaims?.[ClaimsPersonSchemaorg.birthDate] as string | undefined);
    const controllerEmail =
      (typeof kycPayload.controllerEmail === 'string' ? kycPayload.controllerEmail : undefined) ||
      (fallbackClaims?.[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined) ||
      (fallbackClaims?.[ClaimsPersonSchemaorg.email] as string | undefined);

    return buildClaimsFromIndividualOrganizationKyc({
      profile,
      individualAlternateName: String(individualAlternateName || ''),
      individualBirthDate,
      controllerEmail,
    }).claims as ClaimsRecord;
  }

  private async processFamilyOrderEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const entryType = entry.type || 'Family-order-request-v1.0';
    const rawClaims = entry?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed order entry: missing meta.claims', IssueType.Required);
    }

    const offerId = getClaimValue<string>(claims, ClaimsOrderSchemaorg.acceptedOfferIdentifier);
    if (!offerId) {
      throw new ManagerError(
        formatMissingRequiredClaimDiagnostic(ClaimsOrderSchemaorg.acceptedOfferIdentifier, {
          context: 'in Order',
          displayLabel: toExternalClaimLabel(ClaimsOrderSchemaorg.acceptedOfferIdentifier),
        }),
        IssueType.Required,
      );
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
      return this.processFamilyLicenseOrderEntry(job, claims, offerId);
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

      const controllerEmail =
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined;
      const controllerPhoneForActivation =
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerTelephone] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.telephone] as string | undefined;
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
      email:
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined,
      legalName: finalizedContent.claims[ClaimsOrganizationSchemaorg.legalName] as string | undefined,
      addressCountry: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined,
      addressRegion: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressRegion] as string | undefined,
      addressLocality: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressLocality] as string | undefined,
      postalCode: finalizedContent.claims[ClaimsOrganizationSchemaorg.postalCode] as string | undefined,
      streetAddress: finalizedContent.claims[ClaimsOrganizationSchemaorg.streetAddress] as string | undefined,
      activationCode: (finalizedContent.claims as any)['org.schema.IndividualProduct.serialNumber'] as string | undefined,
      activationCategory: (finalizedContent.claims as any)['org.schema.IndividualProduct.category'] as string | undefined,
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
      invoiceId: claims[ClaimsOrderSchemaorg.partOfInvoice] as string | undefined,
      paymentConfirmed: true,
      ...readOfferPaymentContext(finalizedContent.claims),
    };
    const paymentCommunication = await buildPaymentCommunication(paymentContext);
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || paymentCommunication.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]
        || offerId,
      ),
      subjectReference: recipientDid,
      issuerReference: tenantDid,
      recipientReference: recipientDid,
      issuedAt: String(
        paymentCommunication.claims['org.schema.Order.invoiceIssuedAt']
        || new Date().toISOString(),
      ),
      amount: String(finalizedContent.claims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(finalizedContent.claims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
    });

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
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Family-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
      resource: invoiceBundle as any,
      response: { status: '201' },
    };
  }

  private async processFamilyLicenseOrderEntry(
    job: JobRequest,
    orderClaims: ClaimsRecord,
    offerId: string,
  ): Promise<BundleEntry | ErrorEntry> {
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

    const records = await this.vaultRepository.query(
      tenantCollectionName,
      {
        sectionId: getEnvSectionId('communications'),
        where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
      },
      { hydrate: false },
    );
    let matchedOfferClaims: Record<string, unknown> | undefined;
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const candidateClaims = readProjectedOfferOrderClaims(secureDoc);
      if (String(candidateClaims[ClaimsOfferSchemaorg.identifier] || '').trim() === offerId) {
        matchedOfferClaims = candidateClaims;
        break;
      }
    }
    if (!matchedOfferClaims) {
      throw new ManagerError(`No pending family registration or commercial offer found for offerId: '${offerId}'`, IssueType.NotFound);
    }

    const verification = await verifyOrderPaymentConfirmation({
      orderClaims,
      offerClaims: matchedOfferClaims,
    });
    if (!verification.verified) {
      throw new ManagerError(`Payment confirmation failed for offerId '${offerId}'.`, IssueType.Conflict);
    }

    const quantity = Number(matchedOfferClaims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1);
    const now = Date.now();
    const expiryDate = new Date(now);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      const license: DeviceLicense = {
        id: licenseId,
        tenantId,
        orderId: verification.invoiceId || offerId,
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

    const tenantDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!tenantDid) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const paymentCommunication = await buildPaymentCommunication({
      offerId,
      tenantId,
      tenantDid,
      senderDid: tenantDid,
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
      invoiceId: verification.invoiceId,
      paymentConfirmed: true,
      ...readOfferPaymentContext(matchedOfferClaims),
    });
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || verification.invoiceId
        || offerId,
      ),
      subjectReference: tenantDid,
      issuerReference: tenantDid,
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
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Family-order-response-v1.0',
      meta: { claims: paymentCommunication.claims },
      resource: invoiceBundle as any,
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

    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
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

    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
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
    await this.purgeIndividualSubjectData({
      tenantVaultId,
      tenantCollectionName,
      familyRecord: foundResult,
      familyContent,
      lifecycleClaims: claims,
    });

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

  /**
   * Destructively removes one individual/family registration plus every
   * subject-scoped section and best-effort blob reference derived from it.
   */
  private async purgeIndividualSubjectData(params: {
    tenantVaultId: string;
    tenantCollectionName: string;
    familyRecord: ConfidentialStorageDoc;
    familyContent: FamilyRegistrationContent;
    lifecycleClaims?: ClaimsRecord;
  }): Promise<void> {
    const collectionNames = [...new Set([params.tenantVaultId, params.tenantCollectionName].filter(Boolean))];
    const subjectIdentifiers = this.collectFamilySubjectIdentifiers(params.familyContent, params.lifecycleClaims);

    for (const subjectIdentifier of subjectIdentifiers) {
      await this.purgeSubjectScopedSections(collectionNames, subjectIdentifier);
    }

    await this.deleteStoredRecordWithBlobs(
      params.tenantCollectionName,
      params.familyRecord.id,
      INDIVIDUAL_SECTION,
      params.familyRecord,
      params.familyContent as unknown as Record<string, any>,
    );
  }

  private collectFamilySubjectIdentifiers(
    content: FamilyRegistrationContent,
    lifecycleClaims?: ClaimsRecord,
  ): string[] {
    const claims = {
      ...(content?.claims || {}),
      ...(lifecycleClaims || {}),
    };
    const identifiers = [
      claims[ClaimsOrganizationSchemaorg.identifier],
      claims[ClaimsPersonSchemaorg.identifier],
      claims[ClaimsServiceSchemaorg.identifier],
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    for (const resource of Array.isArray(content?.contained) ? content.contained : []) {
      const resourceId = String((resource as Record<string, unknown>)?.id || '').trim();
      if (resourceId) {
        identifiers.push(resourceId);
      }
    }

    return [...new Set(identifiers)];
  }

  private async purgeSubjectScopedSections(collectionNames: string[], subjectIdentifier: string): Promise<void> {
    const subjectHash = createHash('sha256').update(subjectIdentifier, 'utf8').digest('hex');

    for (const collectionName of collectionNames) {
      const sectionIds = await this.vaultRepository.getAllSections(collectionName);
      for (const sectionId of sectionIds) {
        if (!sectionId.startsWith(getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_`)) || !sectionId.endsWith(subjectHash)) {
          continue;
        }

        const records = await this.vaultRepository.getContainersInSection<any>(collectionName, sectionId);
        for (const record of records) {
          const recordId = String(record?.id || '').trim();
          if (!recordId) {
            continue;
          }
          await this.deleteStoredRecordWithBlobs(collectionName, recordId, sectionId, record);
        }
      }
    }
  }

  private async deleteStoredRecordWithBlobs(
    collectionName: string,
    recordId: string,
    sectionId: string,
    record: Record<string, any>,
    additionalBlobReferenceSource?: Record<string, any>,
  ): Promise<void> {
    await this.deleteBlobReferencesFromRecord(record, additionalBlobReferenceSource);
    await this.vaultRepository.delete(collectionName, recordId, sectionId);
  }

  private async deleteBlobReferencesFromRecord(
    record: Record<string, any>,
    additionalBlobReferenceSource?: Record<string, any>,
  ): Promise<void> {
    if (!record || typeof record !== 'object') {
      return;
    }

    const blobRefs = [...new Set([
      ...this.collectBlobReferenceStrings(record),
      ...this.collectBlobReferenceStrings(additionalBlobReferenceSource),
    ])];
    for (const blobRef of blobRefs) {
      if (!blobRef || !this.storageAdapter.delete) {
        continue;
      }
      await this.storageAdapter.delete(blobRef).catch(() => undefined);
    }
  }

  private collectBlobReferenceStrings(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.collectBlobReferenceStrings(entry));
    }

    const blobRefs: string[] = [];
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nestedValue === 'string' && (key === 'blobRef' || key.endsWith('#hash'))) {
        blobRefs.push(nestedValue);
      }
      blobRefs.push(...this.collectBlobReferenceStrings(nestedValue));
    }
    return blobRefs;
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

    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
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
    const email = normalizeIndexedEmail(String(
      familyContent.claims[ClaimsPersonSchemaorg.email]
      || familyContent.claims[ClaimsOrganizationSchemaorg.ownerEmail]
      || '',
    ));

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
      const matchesInviteEmail =
        email && normalizeIndexedEmail(String(license.issuedToEmail || '')) === email;
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
