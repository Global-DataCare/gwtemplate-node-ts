// src/managers/RelatedPersonManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import {
  extractLedgerSafeResearchTags,
  normalizeFhirIngestionFormat,
  validateFhirPayloadByVersion,
} from '../utils/fhir-ingestion';
import { applyFhirCidVersioningToEntry, FhirCidVersionMapping, registerFhirCidMappings } from '../utils/fhir-versioning';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { ACTION_PURGE, SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { InteroperableLifecycleStatuses } from 'gdc-common-utils-ts/utils/interoperable-resource-operation';
import type { ITenantsManager } from './ITenantsManager';

type FhirBundleEntryLike = {
  type?: string;
  meta?: { claims?: Record<string, any> };
  resource?: any;
  request?: any;
};

type FhirBundleLike = {
  resourceType?: string;
  type?: string;
  entry?: FhirBundleEntryLike[];
};

type StoredRelatedPersonRecord = {
  id: string;
  status?: string;
  meta?: Record<string, any>;
  [key: string]: any;
};

function getEntryClaims(entry: FhirBundleEntryLike): Record<string, any> | undefined {
  const resourceClaims = entry?.resource?.meta?.claims;
  if (resourceClaims && typeof resourceClaims === 'object') {
    return resourceClaims as Record<string, any>;
  }
  const legacyClaims = entry?.meta?.claims;
  if (legacyClaims && typeof legacyClaims === 'object') {
    return legacyClaims as Record<string, any>;
  }
  return undefined;
}

function getEntryLifecycleStatus(entry: FhirBundleEntryLike): string | undefined {
  const status = entry?.resource?.meta?.status;
  return typeof status === 'string' && status.trim() ? status.trim() : undefined;
}

function normalizeStoredRelatedPersonRecord(record: any): StoredRelatedPersonRecord | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const content = record.content && typeof record.content === 'object' ? record.content : record;
  return {
    ...(content as Record<string, any>),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(content?.meta && typeof content.meta === 'object' ? { meta: { ...content.meta } } : {}),
  } as StoredRelatedPersonRecord;
}

/**
 * Registers family member relationships / emergency contacts using FHIR RelatedPerson-style claims.
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`
 * - Payload is a DIDComm message whose body is a FHIR Bundle with `entry[]` and `meta.claims` using `@context: org.hl7.fhir.api`.
 */
export class RelatedPersonManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
    private readonly tenantsCacheManager?: ITenantsManager,
  ) {}

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    if (!jurisdiction || !normalizedSection || !normalizedFormatRaw || !normalizedAction) {
      throw new ManagerError('Missing jurisdiction, section, format, or action.', IssueType.Required);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);
    const scope: SubjectSectionScope =
      normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL;

    const bundle = (job.content?.body || {}) as any;
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];

    const responseEntries: any[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    for (const entry of entries) {
        const rawClaims = getEntryClaims(entry);
        try {
          if (!rawClaims || typeof rawClaims !== 'object') {
            throw new ManagerError('Missing resource.meta.claims in RelatedPerson entry.', IssueType.Required);
          }
          validateFhirPayloadByVersion(normalizedFormat, 'RelatedPerson', entry);

          const claims = normalizeContextualizedClaims(rawClaims);
        const researchTags = extractLedgerSafeResearchTags(entry);
        const subject =
          getClaimValue<string>(claims, 'RelatedPerson.patient') ||
          getClaimValue<string>(claims, 'RelatedPerson.subject');
        if (!subject) {
          throw new ManagerError('Missing RelatedPerson.patient (or RelatedPerson.subject) claim.', IssueType.Required);
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.tenantExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, 'RelatedPerson.identifier') ||
          getClaimValue<string>(claims, 'RelatedPerson.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'RelatedPerson',
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

        const sectionId = getSubjectScopedSectionId(subject, scope, 'related-persons');
        if (normalizedAction === ACTION_PURGE) {
          const existingRaw = await this.vaultRepository.get<any>(tenantVaultId, id, sectionId);
          const existingRecord = normalizeStoredRelatedPersonRecord(existingRaw);
          if (!existingRecord) {
            throw new ManagerError(`RelatedPerson not found for purge: ${id}`, IssueType.NotFound);
          }
          if (existingRecord.status !== EntityLifecycleStatus.Inactive) {
            throw new ManagerError('RelatedPerson must be disabled before purge.', IssueType.Conflict);
          }
          const updatedRecord: Record<string, any> = {
            ...existingRecord,
            status: InteroperableLifecycleStatuses.Purged,
            meta: {
              ...(existingRecord.meta || {}),
              lifecycleDisposition: 'purged',
              lifecyclePurgedAt: new Date().toISOString(),
            },
          };
          await this.vaultRepository.put(tenantVaultId, [updatedRecord as any], sectionId);

          const responseAction = `${normalizedAction}-response`;
          responseEntries.push({
            type: 'RelatedPerson',
            response: {
              status: '200',
              location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/RelatedPerson/${responseAction}`,
            },
            meta: {
              claims,
              ...(researchTags && researchTags.length > 0 ? { tag: researchTags } : {}),
            },
          });
          continue;
        }

        const requestedLifecycleStatus = getEntryLifecycleStatus(entry);
        const record: Record<string, any> = {
          id,
          ...claims,
          ...(requestedLifecycleStatus ? { status: requestedLifecycleStatus } : {}),
        };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        if (versioning.mapping) cidMappings.push(versioning.mapping);

        const responseAction = `${normalizedAction}-response`;
        responseEntries.push({
          type: 'RelatedPerson',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/RelatedPerson/${responseAction}`,
          },
          meta: {
            claims,
            ...(researchTags && researchTags.length > 0 ? { tag: researchTags } : {}),
          },
        });
      } catch (e: any) {
        const status = e instanceof ManagerError ? e.status : '400';
        const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
        responseEntries.push({
          type: 'RelatedPerson',
          meta: { claims: rawClaims || {} },
          response: {
            status,
            outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || String(e)),
          },
        });
      }
    }

    await registerFhirCidMappings({
      blockchainAdapter: this.blockchainAdapter,
      sector: job.sector,
      jurisdiction,
      mappings: cidMappings,
    });

    return {
      jti: randomUUID(),
      type: 'transaction-response',
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: `${normalizedAction}-response`,
        data: responseEntries,
      },
    };
  }
}
