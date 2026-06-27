// src/managers/CompositionManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import {
  buildFhirClaimKeys,
  canonicalizeFhirClaims,
  getClaimValue,
  getFirstClaimValueByKeys,
  normalizeContextualizedClaims,
} from '../utils/claims';
import { filterCompositionMatchesBySectionsAndTypes, filterDocumentReferenceMatches } from '../utils/composition-search';
import {
  extractTokenCode,
  normalizeReference,
  pickLatestIsoDate,
  resolveBundleEntryFullUrl,
  resolveBundleEntryKey,
  tokenToCoding,
} from '../utils/fhir-data-utils';
import { buildFhirResourceFromIndexedClaims } from '../utils/fhir-resource-rehydration';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import { getEnvSectionId } from '../utils/section-env';
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
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import {
  extractCompositionExcludedSearchSections,
  extractCompositionSearchSections,
  extractCompositionSearchSubject,
  extractCompositionSearchTypes,
  extractCommunicationSearchFilters,
  extractDocumentReferenceSearchFilters,
  extractRequestedBundleType,
  extractSearchResourceType,
} from '../utils/search-request';
import { HealthcareBasicSections } from '../shared/healthcare-constants';
import { GatewayLocalFhirResourceTypes, ResourceTypesFhirR4 } from '../shared/fhir-constants';
import { GatewayEnvelopeTypes, GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { DataCollectionIds } from '../shared/data-collections';
import { BundleType } from '../utils/bundle';
import type { ITenantsManager } from './ITenantsManager';
import { TwinCompositionManager, TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from './TwinCompositionManager';

/**
 * Canonical HL7 IPS "all sections" example used to validate the current
 * section-first digital twin search contract:
 * https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html
 *
 * The gateway exposes those sections through `HealthcareSummarySections`,
 * which extends the upstream common-utils basic catalog with the IPS-specific
 * tokens still missing there.
 */
export const IPS_ALL_SECTIONS_EXAMPLE_URL =
  'https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html' as const;

/**
 * Internal subject-scoped storage collection ids used to fan out a digital
 * twin `Composition/_search` into resource-family indexes.
 *
 * These are not IPS section tokens and they are not equivalent to
 * `HealthcareSummarySections`:
 * - `HealthcareSummarySections` is the public/documental section taxonomy
 *   expressed as LOINC tokens
 * - `DIGITAL_TWIN_RESOURCE_COLLECTION_IDS` is the private persistence taxonomy
 *   expressed as per-family collection suffixes such as `medications` or
 *   `observations`
 */
const SUMMARY_OPERATION_ACTION = '$summary';
const SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE = 'subject';
const SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE = 'patient';
const SUMMARY_OPERATION_RESEARCHSUBJECT_RESOURCE_TYPE = 'researchsubject';
const SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES = Object.freeze([
  'health-',
  'animal-',
  'onehealth-',
] as const);

/**
 * Legacy/compatibility manager for direct `Composition` and `Bundle` jobs.
 *
 * Current responsibility boundary:
 * - `individual`
 *   - still handles the lower-level direct `Composition` / `Bundle` routes
 *     that remain exposed for compatibility
 *   - still resolves `Subject/$summary` and direct document retrieval
 *   - is also called indirectly by `CommunicationManager` when a
 *     `Communication` envelope embeds `Subject/$summary` or `Bundle/_search`
 * - `digitaltwin`
 *   - ingestion of pre-converted twin `Composition` payloads still lands here
 *   - public twin search semantics no longer belong conceptually to this class
 *   - those are delegated to `TwinCompositionManager`
 *
 * Important clarification:
 * - the canonical public read model for `individual` is `Communication`
 *   carrying structured requests, not teaching users to call direct
 *   `individual/.../Composition` routes first
 * - the direct `individual/.../Composition` routes therefore exist mainly as
 *   compatibility / lower-level plumbing and test anchors
 */
export class CompositionManager implements IJobProcessor {
  private readonly twinCompositionManager: TwinCompositionManager;

  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
    private readonly tenantsCacheManager?: ITenantsManager,
  ) {
    this.twinCompositionManager = new TwinCompositionManager(vaultRepository);
  }

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [];
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const normalizedResourceType = String(job.resourceType || '').trim().toLowerCase();
    const jurisdiction = String(job.jurisdiction || '').trim();
    const isSummaryOperation = normalizedAction === SUMMARY_OPERATION_ACTION;

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
    if (normalizedAction !== '_batch' && normalizedAction !== '_search' && !isSummaryOperation) {
      throw new Error(`Unsupported action '${normalizedAction}' for CompositionManager.`);
    }
    if (
      isSummaryOperation
      && !(
        (normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN && normalizedResourceType === SUMMARY_OPERATION_RESEARCHSUBJECT_RESOURCE_TYPE)
        || (
          normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN
          && normalizedResourceType === SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE
        )
        || (
          normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN
          && normalizedResourceType === SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE
        )
      )
    ) {
      throw new Error(`Unsupported resourceType '${job.resourceType}' for CompositionManager summary operation.`);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new Error(`Unsupported section '${normalizedSection}' for CompositionManager.`);
    }
    if (isSummaryOperation && !this.isSupportedSummarySector(String(job.sector || ''))) {
      throw new Error(`Unsupported sector '${job.sector}' for summary operation.`);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);

    const scope: SubjectSectionScope =
      normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL;

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    if (normalizedAction === '_search' || isSummaryOperation) {
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const tenantExists = await this.tenantExists(tenantVaultId);
      if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

      const searchResourceType = isSummaryOperation
        ? 'bundle'
        : extractSearchResourceType(body);
      const useDocumentReferenceSection = searchResourceType === 'documentreference';
      const useCommunicationSection = searchResourceType === 'communication';
      const searchSubject = extractCompositionSearchSubject(body);
      if (!searchSubject && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
        throw new Error('Missing required subject search parameter for Composition search.');
      }
      const searchSections = extractCompositionSearchSections(body);
      const excludedSearchSections = extractCompositionExcludedSearchSections(body);
      const searchTypes = isSummaryOperation
        ? this.extractSummaryTypes(body)
        : extractCompositionSearchTypes(body);
      const requestedBundleType = isSummaryOperation
        ? 'document'
        : extractRequestedBundleType(body);
      const documentReferenceFilters = extractDocumentReferenceSearchFilters(body);
      const communicationFilters = extractCommunicationSearchFilters(body);

      if (this.isIpsBundleDocumentRequest(searchResourceType, requestedBundleType, searchTypes)) {
        const consolidatedBundle = await this.buildConsolidatedIpsBundleDocument({
          tenantVaultId,
          subject: searchSubject,
          scope,
          requiredSections: searchSections,
          excludedSections: excludedSearchSections,
          requiredTypes: searchTypes,
        });
        const projectedBundle = this.projectSummaryBundleByFormat(consolidatedBundle, normalizedFormat);

        const responseBundle: BundleJsonApi = {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: BundleType.BatchResponse,
          data: [{
            type: isSummaryOperation ? GatewayResponseEntryTypes.BundleSummary : GatewayResponseEntryTypes.BundleSearch,
            resource: projectedBundle,
            response: { status: '200' },
          } as any],
          total: 1,
        };

        return {
          jti: randomUUID(),
          type: GatewayEnvelopeTypes.TransactionResponse,
          thid: job.content?.thid as string,
          iss: job.content?.aud as string,
          aud: job.content?.iss as string,
          body: responseBundle,
        };
      }

      if (normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN && searchResourceType === 'composition' && !searchSubject) {
        const matches = await this.twinCompositionManager.searchBySectionAndClaims({
          tenantVaultId,
          requiredSections: searchSections,
          excludedSections: excludedSearchSections,
          body,
          filterMatchesBySectionsAndTypes: this.filterMatchesBySectionsAndTypes.bind(this),
        });
        const responseBundle: BundleJsonApi = {
          resourceType: ResourceTypesFhirR4.Bundle,
          type: BundleType.BatchResponse,
          data: [{
            type: GatewayResponseEntryTypes.CompositionSearch,
            resource: { total: matches.length, data: matches },
            response: { status: '200' },
          } as any],
          total: 1,
        };

        return {
          jti: randomUUID(),
          type: GatewayEnvelopeTypes.TransactionResponse,
          thid: job.content?.thid as string,
          iss: job.content?.aud as string,
          aud: job.content?.iss as string,
          body: responseBundle,
        };
      }

      const sectionId = getSubjectScopedSectionId(
        searchSubject!,
        scope,
        useDocumentReferenceSection ? 'document-references' : useCommunicationSection ? 'communications' : 'composition',
      );
      const matchesRaw = await this.vaultRepository.listContainersInSection(tenantVaultId, sectionId);
      const matches = useDocumentReferenceSection
        ? this.filterDocumentReferenceMatches(matchesRaw, documentReferenceFilters)
        : useCommunicationSection
          ? await this.filterCommunicationMatches(tenantVaultId, searchSubject, scope, matchesRaw, communicationFilters)
          : this.filterMatchesBySectionsAndTypes(matchesRaw, searchSections, excludedSearchSections, searchTypes);
      const responseBundle: BundleJsonApi = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleType.BatchResponse,
        data: [{
          type: useDocumentReferenceSection
            ? GatewayResponseEntryTypes.DocumentReferenceSearch
            : useCommunicationSection
              ? GatewayResponseEntryTypes.CommunicationSearch
              : GatewayResponseEntryTypes.CompositionSearch,
          resource: { total: matches.length, data: matches },
          response: { status: '200' },
        } as any],
        total: 1,
      };

      return {
        jti: randomUUID(),
        type: GatewayEnvelopeTypes.TransactionResponse,
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
        if (resourceType === GatewayLocalFhirResourceTypes.OperationOutcome) {
          // Preconversion may include row-level OperationOutcome entries as warnings.
          // They are informational and should not be persisted as Composition claims.
          responseEntries.push({
            type: GatewayResponseEntryTypes.OperationOutcome,
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
        const tenantExists = await this.tenantExists(tenantVaultId);
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
      type: GatewayEnvelopeTypes.TransactionResponse,
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  private isSupportedSummarySector(sector: string): boolean {
    const normalizedSector = String(sector || '').trim().toLowerCase();
    return SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES.some((prefix) => normalizedSector.startsWith(prefix));
  }

  private extractSummaryTypes(body: any): string[] {
    const explicitTypes = extractCompositionSearchTypes(body);
    if (explicitTypes.length > 0) return explicitTypes;
    return [HealthcareBasicSections.PatientSummaryDocument.attributeValue];
  }

  private filterDocumentReferenceMatches(
    matches: any[],
    filters: { identifier?: string; attachmentHash?: string },
  ): any[] {
    return filterDocumentReferenceMatches(matches, filters);
  }

  private isIpsBundleDocumentRequest(
    searchResourceType: string,
    requestedBundleType: string,
    requiredTypes: string[],
  ): boolean {
    if (searchResourceType !== 'bundle') return false;
    if (String(requestedBundleType || '').trim().toLowerCase() !== 'document') return false;
    if (!Array.isArray(requiredTypes) || requiredTypes.length === 0) return false;

    const ipsCode = HealthcareBasicSections.PatientSummaryDocument.code;
    return requiredTypes.some((value) => extractTokenCode(value) === ipsCode);
  }

  private async buildConsolidatedIpsBundleDocument(params: {
    tenantVaultId: string;
    subject: string;
    scope: SubjectSectionScope;
    requiredSections: string[];
    excludedSections: string[];
    requiredTypes: string[];
  }): Promise<Record<string, any>> {
    const compositionSectionId = getSubjectScopedSectionId(params.subject, params.scope, 'composition');
    const compositionRecords = await this.vaultRepository.listContainersInSection(params.tenantVaultId, compositionSectionId);

    const sectionRefs = new Map<string, Set<string>>();
    const bundleEntries = new Map<string, { fullUrl?: string; resource: Record<string, any> }>();
    const authorRefs = new Set<string>();
    const compositionDates: string[] = [];
    const includedSectionTokens = new Set<string>();

    for (const compositionRecord of compositionRecords as Array<Record<string, any>>) {
      const compositionType = String(
        getClaimValue<string>(compositionRecord, 'Composition.type') || '',
      ).trim();
      if (!this.matchesRequiredTypes(compositionType, params.requiredTypes)) continue;

      const sectionToken = String(
        getClaimValue<string>(compositionRecord, 'Composition.section') || '',
      ).trim();
      if (!sectionToken) continue;
      if (params.excludedSections.includes(sectionToken)) continue;
      if (params.requiredSections.length > 0 && !params.requiredSections.includes(sectionToken)) continue;

      includedSectionTokens.add(sectionToken);
      this.ensureSection(sectionRefs, sectionToken);

      const authorReference = normalizeReference(getClaimValue<string>(compositionRecord, 'Composition.author'));
      if (authorReference) authorRefs.add(authorReference);
      const compositionDate = normalizeReference(getClaimValue<string>(compositionRecord, 'Composition.date'));
      if (compositionDate) compositionDates.push(compositionDate);
    }

    for (const sectionToken of includedSectionTokens) {
      const projectionConfigs = TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || [];
      for (const projectionConfig of projectionConfigs) {
        for (const collectionIdSuffix of projectionConfig.collectionIds) {
          const resourceSectionId = getSubjectScopedSectionId(params.subject, params.scope, collectionIdSuffix);
          const resourceRecords = await this.vaultRepository.listContainersInSection(params.tenantVaultId, resourceSectionId);
          for (const resourceRecord of resourceRecords) {
            const resource = buildFhirResourceFromIndexedClaims(projectionConfig.resourceType, resourceRecord);
            const entryKey = resolveBundleEntryKey(undefined, resource);
            if (!bundleEntries.has(entryKey)) {
              bundleEntries.set(entryKey, {
                fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
                resource,
              });
            }
            this.addSectionReference(sectionRefs, sectionToken, entryKey);
          }
        }
      }
    }

    const documentReferenceSectionId = getSubjectScopedSectionId(params.subject, params.scope, DataCollectionIds.documentReferences);
    const documentReferenceRecords = await this.vaultRepository.listContainersInSection(params.tenantVaultId, documentReferenceSectionId);
    for (const documentReferenceRecord of documentReferenceRecords) {
      const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DocumentReference, documentReferenceRecord);
      const entryKey = resolveBundleEntryKey(undefined, resource);
      if (!bundleEntries.has(entryKey)) {
        bundleEntries.set(entryKey, {
          fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
          resource,
        });
      }
    }

    const compositionId = `ips-composition-${determineResourceId(params.subject, process.env.NODE_ENV)}`;
    const compositionIdentifier = `urn:uuid:${compositionId}`;
    const compositionSectionTokens = Array.from(sectionRefs.keys());
    const compositionClaims: Record<string, any> = {
      '@context': 'org.hl7.fhir.r4',
      'Composition.identifier': compositionIdentifier,
      'Composition.subject': params.subject,
      'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
      'Composition.date': pickLatestIsoDate(compositionDates),
      'Composition.section': compositionSectionTokens.join(','),
    };
    if (authorRefs.size > 0) {
      compositionClaims['Composition.author'] = Array.from(authorRefs).join(',');
    }
    const compositionResource: Record<string, any> = {
      resourceType: 'Composition',
      id: compositionId,
      identifier: [{ value: compositionIdentifier }],
      status: 'final',
      meta: {
        claims: compositionClaims,
      },
      type: {
        coding: [{
          system: HealthcareBasicSections.PatientSummaryDocument.system,
          code: HealthcareBasicSections.PatientSummaryDocument.code,
          display: 'Patient summary Document',
        }],
      },
      subject: { reference: params.subject },
      date: compositionClaims['Composition.date'],
      title: 'International Patient Summary',
      section: compositionSectionTokens.map((sectionToken) => ({
        code: {
          coding: [tokenToCoding(sectionToken)],
        },
        entry: Array.from(sectionRefs.get(sectionToken) || []).map((reference) => ({ reference })),
      })),
      ...(authorRefs.size > 0 ? {
        author: Array.from(authorRefs).map((reference) => ({ reference })),
      } : {}),
    };

    return {
      resourceType: 'Bundle',
      type: 'document',
      entry: [
        {
          fullUrl: compositionIdentifier,
          resource: compositionResource,
        },
        ...Array.from(bundleEntries.entries()).map(([reference, entry]) => ({
          fullUrl: entry.fullUrl || reference,
          resource: entry.resource,
        })),
      ],
    };
  }

  private projectSummaryBundleByFormat(bundle: Record<string, any>, format: string): Record<string, any> {
    if (String(format || '').trim().toLowerCase() !== 'org.hl7.fhir.api') {
      return bundle;
    }

    return {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: bundle.type || 'document',
      entry: Array.isArray(bundle.entry)
        ? bundle.entry.map((entry: any) => {
          const resource = entry?.resource || {};
          const claims = resource?.meta?.claims && typeof resource.meta.claims === 'object'
            ? canonicalizeFhirClaims(resource.meta.claims as Record<string, any>)
            : {};
          return {
            fullUrl: String(entry?.fullUrl || '').trim() || `urn:uuid:${String(resource?.id || randomUUID())}`,
            resource: {
              resourceType: String(resource?.resourceType || 'Resource'),
              id: String(resource?.id || ''),
              meta: {
                claims,
              },
            },
          };
        })
        : [],
    };
  }

  private addSectionReference(sectionRefs: Map<string, Set<string>>, sectionToken: string, reference: string): void {
    this.ensureSection(sectionRefs, sectionToken);
    sectionRefs.get(sectionToken)!.add(reference);
  }

  private ensureSection(sectionRefs: Map<string, Set<string>>, sectionToken: string): void {
    if (!sectionRefs.has(sectionToken)) {
      sectionRefs.set(sectionToken, new Set<string>());
    }
  }

  private matchesRequiredTypes(actualType: string, requiredTypes: string[]): boolean {
    if (!requiredTypes.length) return true;
    const actualCode = extractTokenCode(actualType);
    return requiredTypes.some((requiredType) => extractTokenCode(requiredType) === actualCode);
  }

  private filterMatchesBySectionsAndTypes(
    matches: any[],
    requiredSections: string[],
    excludedSections: string[],
    requiredTypes: string[],
  ): any[] {
    return filterCompositionMatchesBySectionsAndTypes(
      matches,
      requiredSections,
      excludedSections,
      requiredTypes,
    );
  }

  private async filterCommunicationMatches(
    tenantVaultId: string,
    subject: string,
    scope: SubjectSectionScope,
    matches: any[],
    filters: {
      identifier?: string;
      thid?: string;
      pthid?: string;
      attachmentHash?: string;
    },
  ): Promise<any[]> {
    if (!Array.isArray(matches)) return [];
    let allowedDocumentReferences: Set<string> | undefined;
    if (filters.attachmentHash) {
      const documentReferenceSectionId = getSubjectScopedSectionId(subject, scope, 'document-references');
      const documentReferences = await this.vaultRepository.listContainersInSection(tenantVaultId, documentReferenceSectionId);
      allowedDocumentReferences = new Set(
        documentReferences
          .filter((record: any) => {
            const attachmentHash = String(
              getFirstClaimValueByKeys(record, buildFhirClaimKeys('DocumentReference.contenthash')) || '',
            ).trim();
            return attachmentHash === filters.attachmentHash;
          })
          .map((record: any) => String(record?.id || '').trim())
          .filter(Boolean),
      );
      if (allowedDocumentReferences.size === 0) return [];
    }

    return matches.filter((record: any) => {
      const identifier = String(record?.['Communication.identifier'] || '').trim();
      const thid = String(record?.thid || '').trim();
      const pthid = String(record?.pthid || '').trim();
      const contentReferences = String(record?.['Communication.content-reference'] || '').split(',').map((value: string) => value.trim()).filter(Boolean);

      if (filters.identifier && identifier !== filters.identifier) return false;
      if (filters.thid && thid !== filters.thid) return false;
      if (filters.pthid && pthid !== filters.pthid) return false;
      if (allowedDocumentReferences) {
        const hasLinkedDocument = contentReferences.some((reference: string) => {
          const referenceId = reference.replace(/^DocumentReference\//i, '').trim();
          return allowedDocumentReferences?.has(referenceId);
        });
        if (!hasLinkedDocument) return false;
      }
      return true;
    });
  }
}
