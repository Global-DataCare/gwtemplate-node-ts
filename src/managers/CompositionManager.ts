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
import { getIndividualSectionId } from '../utils/individual-sections';
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

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      const rawClaims =
        (entry?.meta?.claims as Record<string, any> | undefined) ??
        (entry?.resource?.meta?.claims as Record<string, any> | undefined);

      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new Error('Missing meta.claims for Composition entry.');
        }

        const claims = normalizeContextualizedClaims(rawClaims) as Record<string, any>;

        const subject = getClaimValue<string>(claims, 'Composition.subject');
        if (!subject) throw new Error('Missing required claim: Composition.subject');

        const section = getClaimValue<string>(claims, 'Composition.section');
        if (!section) throw new Error('Missing required claim: Composition.section');

        const author = getClaimValue<string>(claims, 'Composition.author') || job.content?.iss;
        if (!author) throw new Error('Missing required claim: Composition.author');

        const date = getClaimValue<string>(claims, 'Composition.date') || new Date().toISOString();
        const entryRefs = getClaimValue<string>(claims, 'Composition.entry') || '';
        const type = getClaimValue<string>(claims, 'Composition.type') || 'LOINC|60591-5';

        if (!job.tenantId || !job.sector) throw new Error('Missing tenantId or sector.');
        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
        if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

        // Deterministic id for "one section update event".
        const idInput = `${subject}|${section}|${author}|${date}|${type}|${entryRefs}`;
        const id = createHash('sha3-256').update(idInput, 'utf8').digest('hex');

        const record: RecordBase = {
          id,
          ...(claims as any),
        };

        const sectionId = getIndividualSectionId(subject, 'composition');
        await this.vaultRepository.put(tenantVaultId, [record], sectionId);

        responseEntries.push({
          type: 'Composition',
          response: {
            status: '201',
            location: `/${job.sector}/individual/org.hl7.fhir.api/Composition/${id}`,
          },
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
