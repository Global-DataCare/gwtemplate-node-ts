// src/managers/CompositionManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
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
import { determineResourceId } from '../utils/resource';
import { applyFhirCidVersioningToEntry, FhirCidVersionMapping, registerFhirCidMappings } from '../utils/fhir-versioning';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IJobProcessor } from './registry';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';

/**
 * Stores Unified Health Index updates as Composition-style flat claims.
 *
 * Notes:
 * - Input may arrive as FHIR Bundle (`body.entry[]`) or JSON:API Primary Document (`body.data[]`).
 * - Storage is per individual under `individual_composition_<subjectHash>`.
 * - This is a minimal implementation to support demo/SDK flows; indexing semantics can be refined later.
 */
export class CompositionManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
  ) {}

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
    if (normalizedAction !== '_batch' && normalizedAction !== '_search') {
      throw new Error(`Unsupported action '${normalizedAction}' for CompositionManager.`);
    }
    if (normalizedSection !== 'individual' && normalizedSection !== 'digitaltwin') {
      throw new Error(`Unsupported section '${normalizedSection}' for CompositionManager.`);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);

    const scope: SubjectSectionScope =
      normalizedSection === 'digitaltwin' ? 'digitaltwin' : 'individual';

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    if (normalizedAction === '_search') {
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
      if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

      const searchResourceType = this.extractSearchResourceType(body);
      const useDocumentReferenceSection = searchResourceType === 'documentreference';
      const searchSubject = this.extractSearchSubject(body);
      if (!searchSubject) {
        throw new Error('Missing required subject search parameter for Composition search.');
      }
      const searchSections = this.extractSearchSections(body);
      const documentReferenceFilters = this.extractDocumentReferenceSearchFilters(body);

      const sectionId = getSubjectScopedSectionId(
        searchSubject,
        scope,
        useDocumentReferenceSection ? 'document-references' : 'composition',
      );
      const matchesRaw = await this.vaultRepository.getContainersInSection(tenantVaultId, sectionId);
      const matches = useDocumentReferenceSection
        ? this.filterDocumentReferenceMatches(matchesRaw, documentReferenceFilters)
        : this.filterMatchesBySections(matchesRaw, searchSections);
      const responseBundle: BundleJsonApi = {
        resourceType: 'Bundle',
        type: 'batch-response',
        data: [{
          type: useDocumentReferenceSection ? 'DocumentReference-search-response-v1.0' : 'Composition-search-response-v1.0',
          resource: { total: matches.length, data: matches },
          response: { status: '200' },
        } as any],
        total: 1,
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

        const identifierClaim =
          getClaimValue<string>(claims, 'Composition.identifier') ||
          getClaimValue<string>(claims, 'Composition.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'Composition',
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

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
        if (versioning.mapping) cidMappings.push(versioning.mapping);

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

    await registerFhirCidMappings({
      blockchainAdapter: this.blockchainAdapter,
      sector: job.sector,
      jurisdiction,
      mappings: cidMappings,
    });

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

  private extractSearchSubject(body: any): string {
    // FHIR Parameters style:
    // {
    //   "resourceType":"Parameters",
    //   "parameter":[{"name":"subject","valueString":"did:..." }]
    // }
    const parameters = Array.isArray(body?.parameter) ? body.parameter : [];
    for (const p of parameters) {
      if (String(p?.name || '').toLowerCase() !== 'subject') continue;
      const value = String(p?.valueString || p?.valueUri || p?.valueReference?.reference || '').trim();
      if (value) return value;
    }

    // FHIR Batch style search wrapper:
    // body.entry[0].request.url === "Composition?subject=did:..."
    // JSON:API compatibility can rename entry -> data, so accept both.
    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const queryIndex = requestUrl.indexOf('?');
      if (queryIndex < 0) continue;
      const query = requestUrl.slice(queryIndex + 1);
      const params = new URLSearchParams(query);
      const subject = String(
        params.get('subject')
          || params.get('composition.subject')
          || '',
      ).trim();
      if (subject) return subject;
    }

    return '';
  }

  private extractSearchSections(body: any): string[] {
    const result = new Set<string>();

    const parameters = Array.isArray(body?.parameter) ? body.parameter : [];
    for (const p of parameters) {
      const name = String(p?.name || '').toLowerCase();
      if (name !== 'section' && name !== 'composition.section') continue;
      const value = String(p?.valueString || p?.valueCode || p?.valueCoding?.code || '').trim();
      if (!value) continue;
      value.split(',').map((v) => v.trim()).filter(Boolean).forEach((v) => result.add(v));
    }

    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const queryIndex = requestUrl.indexOf('?');
      if (queryIndex < 0) continue;
      const query = requestUrl.slice(queryIndex + 1);
      const params = new URLSearchParams(query);
      const sectionRaw = String(
        params.get('section')
          || params.get('composition.section')
          || '',
      ).trim();
      if (!sectionRaw) continue;
      sectionRaw.split(',').map((v) => v.trim()).filter(Boolean).forEach((v) => result.add(v));
    }

    return Array.from(result);
  }

  private extractSearchResourceType(body: any): string {
    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const target = requestUrl.split('?')[0]?.trim();
      if (!target) continue;
      return target.toLowerCase();
    }
    return 'composition';
  }

  private extractDocumentReferenceSearchFilters(body: any): {
    identifier?: string;
    attachmentHash?: string;
  } {
    let identifier = '';
    let attachmentHash = '';

    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const queryIndex = requestUrl.indexOf('?');
      if (queryIndex < 0) continue;
      const query = requestUrl.slice(queryIndex + 1);
      const params = new URLSearchParams(query);
      identifier =
        identifier
        || String(params.get('identifier') || params.get('documentreference.identifier') || '').trim();
      attachmentHash =
        attachmentHash
        || String(
          params.get('contenthash')
            || params.get('documentreference.contenthash')
            || params.get('attachment.hash')
            || '',
        ).trim();
    }

    return {
      identifier: identifier || undefined,
      attachmentHash: attachmentHash || undefined,
    };
  }

  private filterDocumentReferenceMatches(
    matches: any[],
    filters: { identifier?: string; attachmentHash?: string },
  ): any[] {
    if (!Array.isArray(matches)) return [];
    const requiredIdentifier = String(filters.identifier || '').trim();
    const requiredAttachmentHash = String(filters.attachmentHash || '').trim();
    if (!requiredIdentifier && !requiredAttachmentHash) return matches;

    return matches.filter((record: any) => {
      const identifier = String(
        record?.['DocumentReference.identifier']
          || record?.['org.hl7.fhir.r4.DocumentReference.identifier']
          || '',
      ).trim();
      const attachmentHash = String(
        record?.['DocumentReference.contenthash']
          || record?.['org.hl7.fhir.r4.DocumentReference.contenthash']
          || '',
      ).trim();

      if (requiredIdentifier && identifier !== requiredIdentifier) return false;
      if (requiredAttachmentHash && attachmentHash !== requiredAttachmentHash) return false;
      return true;
    });
  }

  private filterMatchesBySections(matches: any[], requiredSections: string[]): any[] {
    if (!Array.isArray(matches)) return [];
    if (!requiredSections || requiredSections.length === 0) return matches;

    const required = new Set(requiredSections.map((s) => String(s || '').trim()).filter(Boolean));
    if (required.size === 0) return matches;

    return matches.filter((record: any) => {
      const keys = [
        'Composition.section',
        'org.hl7.fhir.r4.Composition.section',
        'org.hl7.fhir.api.Composition.section',
      ];
      let sectionValue = '';
      for (const key of keys) {
        const candidate = String(record?.[key] || '').trim();
        if (candidate) {
          sectionValue = candidate;
          break;
        }
      }
      if (!sectionValue) return false;
      const got = new Set(sectionValue.split(',').map((v: string) => v.trim()).filter(Boolean));
      for (const req of required) {
        if (got.has(req)) return true;
      }
      return false;
    });
  }
}
