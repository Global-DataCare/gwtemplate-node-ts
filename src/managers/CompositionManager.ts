// src/managers/CompositionManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { createHash, randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import {
  extractLedgerSafeResearchTags,
  normalizeFhirIngestionFormat,
  validateFhirPayloadByVersion,
} from '../utils/fhir-ingestion';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IJobProcessor } from './registry';

/**
 * Stores Unified Health Index updates as Composition-style flat claims.
 *
 * Notes:
 * - Input may arrive as FHIR Bundle (`body.entry[]`) or JSON:API Primary Document (`body.data[]`).
 * - Storage is per individual under `individual_composition_<subjectHash>`.
 * - This is a minimal implementation to support demo/SDK flows; indexing semantics can be refined later.
 */
export class CompositionManager implements IJobProcessor {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [];
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();

    if (!job.tenantId || !job.sector) {
      throw new Error('Missing tenantId or sector.');
    }
    if (!jurisdiction) {
      throw new Error('Missing required job.jurisdiction.');
    }
    if (!normalizedSection) {
      throw new Error('Missing required job.section.');
    }
    if (!normalizedFormatRaw) {
      throw new Error('Missing required job.format.');
    }
    if (!normalizedAction) {
      throw new Error('Missing required job.action.');
    }
    if (normalizedSection !== 'individual' && normalizedSection !== 'digitaltwin') {
      throw new Error(`Unsupported section '${normalizedSection}' for CompositionManager.`);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);

    const scope: SubjectSectionScope =
      normalizedSection === 'digitaltwin' ? 'digitaltwin' : 'individual';

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      let rawClaims: Record<string, any> | undefined;
      try {
        const resourceType = String(entry?.resource?.resourceType || entry?.type || '').trim();
        const responseAction = `${normalizedAction}-response`;
        if (resourceType === 'OperationOutcome') {
          // Preconversion may include row-level OperationOutcome entries as warnings.
          // They are informational and should not be persisted as Composition claims.
          responseEntries.push({
            type: 'OperationOutcome',
            response: {
              status: '200',
              location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/Composition/${responseAction}`,
              outcome: createOperationOutcome(
                IssueLevel.Information,
                IssueType.Value,
                'Skipped OperationOutcome entry from preconversion payload.',
              ),
            },
          } as any);
          continue;
        }

        rawClaims =
          (entry?.meta?.claims as Record<string, any> | undefined) ??
          (entry?.resource?.meta?.claims as Record<string, any> | undefined);

        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new Error('Missing meta.claims for Composition entry.');
        }
        validateFhirPayloadByVersion(normalizedFormat, 'Composition', entry);

        const claims = normalizeContextualizedClaims(rawClaims) as Record<string, any>;
        const researchTags = extractLedgerSafeResearchTags(entry);

        const subject = getClaimValue<string>(claims, 'Composition.subject');
        if (!subject) throw new Error('Missing required claim: Composition.subject');

        const section = getClaimValue<string>(claims, 'Composition.section');
        if (!section) throw new Error('Missing required claim: Composition.section');

        const author = getClaimValue<string>(claims, 'Composition.author') || job.content?.iss;
        if (!author) throw new Error('Missing required claim: Composition.author');

        const date = getClaimValue<string>(claims, 'Composition.date') || new Date().toISOString();
        const entryRefs = getClaimValue<string>(claims, 'Composition.entry') || '';
        const type = getClaimValue<string>(claims, 'Composition.type') || 'LOINC|60591-5';

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
        if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

        // Deterministic id for "one section update event".
        const idInput = `${subject}|${section}|${author}|${date}|${type}|${entryRefs}`;
        const id = createHash('sha3-256').update(idInput, 'utf8').digest('hex');

        const record: RecordBase & { meta?: { tag?: any[] }; tag?: any[] } = {
          id,
          ...(claims as any),
        };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }

        const sectionId = getSubjectScopedSectionId(subject, scope, 'composition');
        await this.vaultRepository.put(tenantVaultId, [record], sectionId);

        responseEntries.push({
          type: 'Composition',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/Composition/${responseAction}`,
          },
          ...(researchTags && researchTags.length > 0 ? { meta: { tag: researchTags } } : {}),
        } as any);
      } catch (e: any) {
        responseEntries.push({
          type: 'Composition',
          meta: { claims: rawClaims || {} },
          response: {
            status: '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, e?.message || String(e)),
          },
        } as any);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: responseEntries,
    };

    return {
      jti: randomUUID(),
      type: 'transaction-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }
}
