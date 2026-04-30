// src/managers/ObservationManager.ts
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
 * Collects "personal" (non-clinical) observations provided by the individual (or their family controller).
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Observation/_batch`
 * - Payload is a DIDComm message whose body is a FHIR Bundle with `entry[]` containing an Observation entry,
 *   and a `meta.claims` object using `@context: org.hl7.fhir.api`.
 */
export class ObservationManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
  ) {}

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
    if (normalizedSection !== 'individual' && normalizedSection !== 'digitaltwin') {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);
    const scope: SubjectSectionScope = normalizedSection === 'digitaltwin' ? 'digitaltwin' : 'individual';

    const bundle = (job.content?.body || {}) as any;

    // Support both:
    // - FHIR Bundle shape: { resourceType:'Bundle', entry:[...] }
    // - JSON:API-ish shape used by some managers/tests: { data:[...] }
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];

    const responseEntries: any[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.meta?.claims;
      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new ManagerError('Missing meta.claims in Observation entry.', IssueType.Required);
        }
        validateFhirPayloadByVersion(normalizedFormat, 'Observation', entry);

        const claims = normalizeContextualizedClaims(rawClaims);
        const researchTags = extractLedgerSafeResearchTags(entry);
        const subject =
          getClaimValue<string>(claims, 'Observation.subject') ||
          getClaimValue<string>(claims, 'Observation.patient');
        if (!subject) {
          throw new ManagerError('Missing Observation.subject claim.', IssueType.Required);
        }

        // Claim aliasing for FHIR search-param style keys.
        // Keep backwards compatibility with earlier examples that used `Observation.valueString` and friends.
        {
          const context = (claims['@context'] as string | undefined) ?? '';
          const prefix = context ? (context.endsWith('.') ? context : `${context}.`) : '';
          const setCanonical = (key: string, value: any) => {
            const canonicalKey = `${prefix}${key}`;
            if (claims[canonicalKey] === undefined) claims[canonicalKey] = value;
          };

          const legacyValueString = getClaimValue<string>(claims, 'Observation.valueString');
          const valueString = getClaimValue<string>(claims, 'Observation.value-string');
          if (legacyValueString && !valueString) setCanonical('Observation.value-string', legacyValueString);

          const legacyValueBoolean = getClaimValue<boolean>(claims, 'Observation.valueBoolean');
          const valueConcept = getClaimValue<string>(claims, 'Observation.value-concept');
          if (legacyValueBoolean !== undefined && valueConcept === undefined) {
            // Encode boolean as token using a standard yes/no system (simple, queryable, language-neutral).
            setCanonical(
              'Observation.value-concept',
              legacyValueBoolean
                ? 'http://terminology.hl7.org/CodeSystem/v2-0136|Y'
                : 'http://terminology.hl7.org/CodeSystem/v2-0136|N'
            );
          }

          // Platform-specific UCUM defaulting for FHIR quantity search syntax:
          // - If system is omitted using the FHIR "||" form, assume UCUM (`http://unitsofmeasure.org`).
          // - Supports comma-separated lists to represent repeated query parameters.
          const valueQuantity = getClaimValue<string>(claims, 'Observation.value-quantity');
          if (typeof valueQuantity === 'string' && valueQuantity.trim().length > 0) {
            const prefixes = ['eq', 'ne', 'gt', 'lt', 'ge', 'le', 'sa', 'eb', 'ap'] as const;
            const normalizeOne = (raw: string) => {
              const s = raw.trim();
              if (!s.includes('||')) return s;

              // Split prefix (2 letters) from the numeric part if present.
              let prefix = '';
              let rest = s;
              const lower = s.toLowerCase();
              const matchedPrefix = prefixes.find((p) => lower.startsWith(p));
              if (matchedPrefix) {
                prefix = s.slice(0, 2);
                rest = s.slice(2);
              }

              const parts = rest.split('||');
              if (parts.length !== 2) return s;
              const numberPart = parts[0];
              const codePart = parts[1];
              if (!numberPart || !codePart) return s;

              return `${prefix}${numberPart}|http://unitsofmeasure.org|${codePart}`;
            };

            const normalized = valueQuantity
              .split(',')
              .map(normalizeOne)
              .join(',');

            setCanonical('Observation.value-quantity', normalized);
          }
        }

        // Backwards/forwards compatibility:
        // - Preferred flat claim: `Observation.date-when` (EventTiming: MORN|AFT|EVE|NIGHT)
        // - Canonical FHIR mapping target: `Observation.effectiveTiming.repeat.when`
        // We materialize the canonical key if only the short claim is provided.
        const dateWhen = getClaimValue<string>(claims, 'Observation.date-when');
        const effectiveWhen = getClaimValue<string>(claims, 'Observation.effectiveTiming.repeat.when');
        if (dateWhen && !effectiveWhen) {
          const context = (claims['@context'] as string | undefined) ?? '';
          const prefix = context ? (context.endsWith('.') ? context : `${context}.`) : '';
          const canonicalKey = `${prefix}Observation.effectiveTiming.repeat.when`;
          claims[canonicalKey] = dateWhen;
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, 'Observation.identifier') ||
          getClaimValue<string>(claims, 'Observation.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'Observation',
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

        const sectionId = getSubjectScopedSectionId(subject, scope, 'observations');
        const record: Record<string, any> = { id, ...claims };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        if (versioning.mapping) cidMappings.push(versioning.mapping);

        const responseAction = `${normalizedAction}-response`;
        responseEntries.push({
          type: 'Observation',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/Observation/${responseAction}`,
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
          type: 'Observation',
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
