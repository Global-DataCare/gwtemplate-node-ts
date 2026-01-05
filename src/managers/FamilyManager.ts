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
import { IssueLevel, IssueType } from 'gdc-sdk-client-ts/src/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { generateLicenseOffer } from '../utils/offer';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { TenantsCacheManager } from './TenantsCacheManager';

type FamilyRegistrationContent = {
  status: EntityLifecycleStatus;
  claims: ClaimsRecord;
  contained: IncludedResource[];
};

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
          if (job.resourceType === 'Organization') {
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
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
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
      'individual',
    );

    const processedClaims: ClaimsRecord = {
      ...claims,
      ...(processedService?.meta.claims || {}),
      ...offerClaims,
      '@type': 'receipt',
    };

    const familyDocId =
      (processedClaims[`${ClaimsOrganizationSchemaorg.identifierValue}`] as string | undefined) || uuidv4();

    const registrationDoc: ConfidentialStorageDoc = {
      id: familyDocId,
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
        contained: [person, processedService].filter(Boolean) as IncludedResource[],
      } satisfies FamilyRegistrationContent,
    };

    const secureDoc = await this.kmsService.protectConfidentialData(registrationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureDoc], 'families');

    return {
      type: 'Family-registration-offer-v1.0',
      meta: { claims: processedClaims },
      resource: { resourceType: 'Organization', id: organization.id },
      response: { status: '201' },
    };
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
      sectionId: 'families',
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
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], 'families');

    return {
      type: 'Organization',
      meta: { claims: finalizedContent.claims },
      resource: { resourceType: 'Organization', id: updatedDoc.id },
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

    if (!resources.organization || !resources.person || !resources.service) {
      throw new ManagerError('Incomplete claims: Organization, Person, and Service resources are required.', IssueType.Required);
    }
    return resources as { organization: IncludedResource; person: IncludedResource; service: IncludedResource };
  }
}
