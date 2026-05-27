// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
/**
 * @fileoverview GW manager for `RelatedPerson` batch persistence and indexed search.
 *
 * @architecture 101
 * - Persist canonical flat claims plus blind-search indexes in the same record.
 * - Search uses indexed attributes first and only applies business filters in memory.
 * - Compatibility aliases are limited to legacy FHIR R4 names already documented.
 */

import { randomUUID } from 'crypto';
import type { ParameterData } from 'gdc-common-utils-ts/models/params';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import {
  ClaimsContextFhirRelatedPerson,
  FHIR_RELATED_PERSON_PATIENT_CLAIM,
} from 'gdc-common-utils-ts/models/fhir-related-person';
import {
  RELATED_PROFILE_SEARCH_PARAM_ACTOR_IDENTIFIER,
  RELATED_PROFILE_SEARCH_PARAM_INCLUDE_INACTIVE,
  RELATED_PROFILE_SEARCH_PARAM_RELATIONSHIP,
  RELATED_PROFILE_SEARCH_PARAM_SUBJECT_ID,
  type RelatedProfileSearchInput,
  type RelatedProfileSummary,
} from 'gdc-common-utils-ts/models/related-profile';
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
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import {
  buildRelatedPersonIndexParameters,
  buildRelatedProfileSummaryFromClaims,
  getRelatedPersonSubjectClaimValue,
  matchesRelatedProfileSearch,
  resolveRelatedPersonActorLocatorClaimName,
} from '../utils/related-profile';

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
 * Registers family member relationships / emergency contacts using FHIR RelatedPerson-style claims.
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`
 * - Payload is a DIDComm message whose body is a FHIR Bundle with `entry[]` and `meta.claims` using `@context: org.hl7.fhir.api`.
 */
export class RelatedPersonManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly kmsService?: IKmsService,
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
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    if (normalizedAction !== '_batch' && normalizedAction !== '_search') {
      throw new ManagerError(`Unsupported action '${normalizedAction}' for RelatedPerson.`, IssueType.NotSupported);
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

    if (normalizedAction === '_search') {
      const query = this.extractSearchInput(bundle);
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
      if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

      const matches = await this.searchRelatedProfiles(tenantVaultId, scope, query);
      return {
        jti: randomUUID(),
        type: 'transaction-response',
        thid,
        iss: job.content?.aud as string,
        aud: job.content?.iss as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        body: {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [{
            type: 'RelatedPerson-search-response-v1.0',
            resource: {
              actorIdentifier: query.actorIdentifier,
              total: matches.length,
              data: matches,
            },
            response: { status: '200' },
          }],
          total: 1,
        },
      };
    }

    for (const entry of entries) {
      const rawClaims = entry?.meta?.claims;
      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new ManagerError('Missing meta.claims in RelatedPerson entry.', IssueType.Required);
        }
        validateFhirPayloadByVersion(normalizedFormat, 'RelatedPerson', entry);

        const claims = normalizeContextualizedClaims(rawClaims);
        const researchTags = extractLedgerSafeResearchTags(entry);
        const subject = getRelatedPersonSubjectClaimValue(claims);
        if (!subject) {
          throw new ManagerError(
            `Missing ${FHIR_RELATED_PERSON_PATIENT_CLAIM} (or ${ClaimsContextFhirRelatedPerson.Subject}) claim.`,
            IssueType.Required,
          );
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, ClaimsContextFhirRelatedPerson.Identifier) ||
          getClaimValue<string>(claims, `${ClaimsContextFhirRelatedPerson.Identifier}.value`);
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'RelatedPerson',
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

        const sectionId = getSubjectScopedSectionId(subject, scope, 'related-persons');
        const record: Record<string, any> = {
          id,
          indexed: {
            attributes: await this.protectIndexParameters(
              buildRelatedPersonIndexParameters(claims),
              tenantVaultId,
            ),
          },
          ...claims,
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

  private extractSearchInput(body: any): RelatedProfileSearchInput {
    const parameterEntries = Array.isArray(body?.parameter) ? body.parameter : [];
    const values = new Map<string, string>();
    for (const parameter of parameterEntries) {
      const name = String(parameter?.name || '').trim();
      if (!name) continue;
      const value = String(
        parameter?.valueString
        || parameter?.valueUri
        || parameter?.valueCode
        || parameter?.valueBoolean
        || '',
      ).trim();
      if (value) values.set(name, value);
    }

    const actorIdentifier = String(
      values.get(RELATED_PROFILE_SEARCH_PARAM_ACTOR_IDENTIFIER)
      || '',
    ).trim();
    if (!actorIdentifier) {
      throw new ManagerError('Missing required search parameter: actorIdentifier.', IssueType.Required);
    }

    return {
      actorIdentifier,
      subjectId: String(values.get(RELATED_PROFILE_SEARCH_PARAM_SUBJECT_ID) || values.get(ClaimsContextFhirRelatedPerson.Subject) || values.get(FHIR_RELATED_PERSON_PATIENT_CLAIM) || '').trim() || undefined,
      relationship: String(values.get(RELATED_PROFILE_SEARCH_PARAM_RELATIONSHIP) || values.get(ClaimsContextFhirRelatedPerson.Relationship) || '').trim() || undefined,
      includeInactive: String(values.get(RELATED_PROFILE_SEARCH_PARAM_INCLUDE_INACTIVE) || '').trim().toLowerCase() === 'true',
    };
  }

  private async searchRelatedProfiles(
    tenantVaultId: string,
    scope: SubjectSectionScope,
    query: RelatedProfileSearchInput,
  ): Promise<RelatedProfileSummary[]> {
    const relatedPersonSections = query.subjectId
      ? [getSubjectScopedSectionId(query.subjectId, scope, 'related-persons')]
      : (await this.vaultRepository.getAllSections(tenantVaultId))
        .filter((sectionId) => sectionId.includes('related-persons'));
    const summaries: RelatedProfileSummary[] = [];
    const actorLocatorClaimName = resolveRelatedPersonActorLocatorClaimName(query.actorIdentifier);
    const protectedQueryAttribute = await this.protectSingleIndexParameter({
      name: actorLocatorClaimName,
      value: query.actorIdentifier,
      type: 'string',
    }, tenantVaultId);

    for (const sectionId of relatedPersonSections) {
      const records = await this.vaultRepository.query(tenantVaultId, {
        section: sectionId,
        equals: {
          'indexed.attributes': protectedQueryAttribute,
        },
      }) as Array<{ id: string; [key: string]: any }>;
      for (const record of records) {
        const summary = buildRelatedProfileSummaryFromClaims(record as Record<string, any>);
        if (!summary) continue;
        if (matchesRelatedProfileSearch(summary, query)) {
          summaries.push(summary);
        }
      }
    }

    summaries.sort((left, right) => {
      const leftSubject = String(left.subjectId || '');
      const rightSubject = String(right.subjectId || '');
      return leftSubject.localeCompare(rightSubject);
    });
    return summaries;
  }

  private async protectIndexParameters(parameters: ParameterData[], tenantVaultId: string): Promise<any[]> {
    if (this.kmsService) {
      return this.kmsService.protectAttributesNameAndValue(parameters, tenantVaultId);
    }
    return parameters.map((parameter) => ({
      name: parameter.name,
      value: String(parameter.value),
      type: parameter.type,
      unique: parameter.unique,
    }));
  }

  private async protectSingleIndexParameter(parameter: ParameterData, tenantVaultId: string): Promise<any> {
    const [protectedAttribute] = await this.protectIndexParameters([parameter], tenantVaultId);
    return protectedAttribute;
  }
}
