// src/managers/ObservationManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-sdk-client-ts/src/models/issue';
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
 * Collects "personal" (non-clinical) observations provided by the individual (or their family controller).
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Observation/_batch`
 * - Payload is a DIDComm message whose body is a FHIR Bundle with `entry[]` containing an Observation entry,
 *   and a `meta.claims` object using `@context: org.hl7.fhir.api`.
 */
export class ObservationManager implements IJobProcessor {
  constructor(private readonly vaultRepository: IVaultRepository) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    if (!job.tenantId || !job.sector || !job.jurisdiction) {
      throw new ManagerError('Missing tenantId, sector, or jurisdiction.', IssueType.Required);
    }

    const bundle = (job.content?.body || {}) as any;

    // Support both:
    // - FHIR Bundle shape: { resourceType:'Bundle', entry:[...] }
    // - JSON:API-ish shape used by some managers/tests: { data:[...] }
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];

    const responseEntries: any[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.meta?.claims;
      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new ManagerError('Missing meta.claims in Observation entry.', IssueType.Required);
        }

        const claims = normalizeContextualizedClaims(rawClaims);
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
        const id = determineResourceId(identifierClaim, process.env.NODE_ENV);

        const sectionId = getIndividualSectionId(subject, 'observations');
        await this.vaultRepository.put(tenantVaultId, [{ id, ...claims } as any], sectionId);

        responseEntries.push({
          type: 'Observation',
          response: { status: '201', location: `/${job.sector}/individual/org.hl7.fhir.api/Observation/${id}` },
          meta: { claims },
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
