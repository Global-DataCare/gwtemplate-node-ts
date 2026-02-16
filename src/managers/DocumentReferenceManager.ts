// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/DocumentReferenceManager.ts

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
import { getIndividualSectionId } from '../utils/individual-sections';

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

/**
 * Stores FHIR DocumentReference-style records as per-subject index entries.
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/DocumentReference/_batch`
 * - Payload supports FHIR Bundle `entry[]` and compatibility envelope `data[]`.
 */
export class DocumentReferenceManager implements IJobProcessor {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    if (!job.tenantId || !job.sector || !job.jurisdiction) {
      throw new ManagerError('Missing tenantId, sector, or jurisdiction.', IssueType.Required);
    }

    const bundle = (job.content?.body || {}) as any;
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];

    const responseEntries: any[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.meta?.claims;
      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new ManagerError('Missing meta.claims in DocumentReference entry.', IssueType.Required);
        }

        const claims = normalizeContextualizedClaims(rawClaims);
        const subject = getClaimValue<string>(claims, 'DocumentReference.subject');
        if (!subject) {
          throw new ManagerError('Missing DocumentReference.subject claim.', IssueType.Required);
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, 'DocumentReference.identifier') ||
          getClaimValue<string>(claims, 'DocumentReference.identifier.value');
        const id = determineResourceId(identifierClaim, process.env.NODE_ENV);

        const sectionId = getIndividualSectionId(subject, 'document-references');
        await this.vaultRepository.put(tenantVaultId, [{ id, ...claims } as any], sectionId);

        responseEntries.push({
          type: 'DocumentReference',
          response: { status: '201', location: `/${job.sector}/individual/${job.format}/DocumentReference/${id}` },
          meta: { claims },
        });
      } catch (e: any) {
        const status = e instanceof ManagerError ? e.status : '400';
        const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
        responseEntries.push({
          type: 'DocumentReference',
          meta: { claims: rawClaims || {} },
          response: {
            status,
            outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || String(e)),
          },
        });
      }
    }

    return {
      jti: randomUUID(),
      type: 'transaction-response',
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: `${String(job.action || '')}-response`,
        data: responseEntries,
      },
    };
  }
}
