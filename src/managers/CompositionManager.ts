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
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import {
  extractSearchFiltersFromParametersResource,
  extractSearchFiltersFromRequestUrl,
  extractSearchResourceTarget,
  SearchFilters,
} from '../utils/search-request';
import { HealthcareBasicSections } from '../shared/healthcare-constants';

type IpsSectionProjectionConfig = {
  sectionIds: string[];
  resourceType: string;
};

const IPS_SECTION_PROJECTION_CONFIG: Readonly<Record<string, readonly IpsSectionProjectionConfig[]>> = Object.freeze({
  [HealthcareBasicSections.HistoryOfMedicationUse.attributeValue]: Object.freeze([
    { sectionIds: ['medications'], resourceType: 'MedicationStatement' },
  ]),
  [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue]: Object.freeze([
    { sectionIds: ['allergies'], resourceType: 'AllergyIntolerance' },
  ]),
  [HealthcareBasicSections.ProblemList.attributeValue]: Object.freeze([
    { sectionIds: ['conditions'], resourceType: 'Condition' },
  ]),
  [HealthcareBasicSections.Results.attributeValue]: Object.freeze([
    { sectionIds: ['observations'], resourceType: 'Observation' },
    { sectionIds: ['diagnostic-reports'], resourceType: 'DiagnosticReport' },
  ]),
  [HealthcareBasicSections.Procedures.attributeValue]: Object.freeze([
    { sectionIds: ['procedures'], resourceType: 'Procedure' },
  ]),
  [HealthcareBasicSections.Immunizations.attributeValue]: Object.freeze([
    { sectionIds: ['immunizations'], resourceType: 'Immunization' },
  ]),
  [HealthcareBasicSections.FunctionalStatus.attributeValue]: Object.freeze([
    { sectionIds: ['observations'], resourceType: 'Observation' },
  ]),
  [HealthcareBasicSections.PlanOfCare.attributeValue]: Object.freeze([
    { sectionIds: ['care-plans'], resourceType: 'CarePlan' },
  ]),
  [HealthcareBasicSections.SocialHistory.attributeValue]: Object.freeze([
    { sectionIds: ['observations'], resourceType: 'Observation' },
  ]),
  [HealthcareBasicSections.VitalSigns.attributeValue]: Object.freeze([
    { sectionIds: ['observations'], resourceType: 'Observation' },
  ]),
  [HealthcareBasicSections.MedicalDevices.attributeValue]: Object.freeze([]),
});

const SUMMARY_OPERATION_ACTION = '$summary';
const SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE = 'subject';
const SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE = 'patient';
const SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES = Object.freeze([
  'health-',
  'animal-',
  'onehealth-',
] as const);

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
      && normalizedResourceType !== SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE
      && normalizedResourceType !== SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE
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
      const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
      if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

      const searchResourceType = isSummaryOperation
        ? 'bundle'
        : this.extractSearchResourceType(body);
      const useDocumentReferenceSection = searchResourceType === 'documentreference';
      const useCommunicationSection = searchResourceType === 'communication';
      const searchSubject = this.extractSearchSubject(body);
      if (!searchSubject) {
        throw new Error('Missing required subject search parameter for Composition search.');
      }
      const searchSections = this.extractSearchSections(body);
      const excludedSearchSections = this.extractExcludedSearchSections(body);
      const searchTypes = isSummaryOperation
        ? this.extractSummaryTypes(body)
        : this.extractSearchTypes(body);
      const requestedBundleType = isSummaryOperation
        ? 'document'
        : this.extractRequestedBundleType(body);
      const documentReferenceFilters = this.extractDocumentReferenceSearchFilters(body);
      const communicationFilters = this.extractCommunicationSearchFilters(body);

      if (this.isIpsBundleDocumentRequest(searchResourceType, requestedBundleType, searchTypes)) {
        const consolidatedBundle = await this.buildConsolidatedIpsBundleDocument({
          tenantVaultId,
          subject: searchSubject,
          scope,
          requiredSections: searchSections,
          excludedSections: excludedSearchSections,
          requiredTypes: searchTypes,
        });

        const responseBundle: BundleJsonApi = {
          resourceType: 'Bundle',
          type: 'batch-response',
          data: [{
            type: isSummaryOperation ? 'Bundle-summary-response-v1.0' : 'Bundle-search-response-v1.0',
            resource: consolidatedBundle,
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

      const sectionId = getSubjectScopedSectionId(
        searchSubject,
        scope,
        useDocumentReferenceSection ? 'document-references' : useCommunicationSection ? 'communications' : 'composition',
      );
      const matchesRaw = await this.vaultRepository.getContainersInSection(tenantVaultId, sectionId);
      const matches = useDocumentReferenceSection
        ? this.filterDocumentReferenceMatches(matchesRaw, documentReferenceFilters)
        : useCommunicationSection
          ? await this.filterCommunicationMatches(tenantVaultId, searchSubject, scope, matchesRaw, communicationFilters)
          : this.filterMatchesBySectionsAndTypes(matchesRaw, searchSections, excludedSearchSections, searchTypes);
      const responseBundle: BundleJsonApi = {
        resourceType: 'Bundle',
        type: 'batch-response',
        data: [{
          type: useDocumentReferenceSection
            ? 'DocumentReference-search-response-v1.0'
            : useCommunicationSection
              ? 'Communication-search-response-v1.0'
              : 'Composition-search-response-v1.0',
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

  private isSupportedSummarySector(sector: string): boolean {
    const normalizedSector = String(sector || '').trim().toLowerCase();
    return SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES.some((prefix) => normalizedSector.startsWith(prefix));
  }

  private extractSearchSubject(body: any): string {
    return this.getFirstSearchFilter(body, ['subject', 'composition.subject']);
  }

  private extractSearchSections(body: any): string[] {
    const result = new Set<string>();
    for (const value of this.getSearchFilterValues(body, ['section', 'composition.section'])) {
      result.add(value);
    }
    return [...result];
  }

  private extractExcludedSearchSections(body: any): string[] {
    const result = new Set<string>();

    const parameters = Array.isArray(body?.parameter) ? body.parameter : [];
    for (const p of parameters) {
      const name = String(p?.name || '').toLowerCase();
      if (
        name !== 'section:not'
        && name !== 'composition.section:not'
        && name !== 'exclude-section'
        && name !== 'exclude-sections'
      ) continue;
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
      const excludedRaw = String(
        params.get('section:not')
          || params.get('composition.section:not')
          || params.get('exclude-section')
          || params.get('exclude-sections')
          || '',
      ).trim();
      if (!excludedRaw) continue;
      excludedRaw.split(',').map((v) => v.trim()).filter(Boolean).forEach((v) => result.add(v));
    }

    return Array.from(result);
  }

  private extractSearchTypes(body: any): string[] {
    const result = new Set<string>();

    const parameters = Array.isArray(body?.parameter) ? body.parameter : [];
    for (const p of parameters) {
      const name = String(p?.name || '').toLowerCase();
      if (name !== 'composition.type' && name !== 'document-type') continue;
      const value = String(
        p?.valueString
          || p?.valueCode
          || (p?.valueCoding?.system && p?.valueCoding?.code ? `${p.valueCoding.system}|${p.valueCoding.code}` : '')
          || '',
      ).trim();
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
      const typeRaw = String(
        params.get('composition.type')
          || '',
      ).trim();
      if (!typeRaw) continue;
      typeRaw.split(',').map((v) => v.trim()).filter(Boolean).forEach((v) => result.add(v));
    }

    return Array.from(result);
  }

  private extractSummaryTypes(body: any): string[] {
    const explicitTypes = this.extractSearchTypes(body);
    if (explicitTypes.length > 0) return explicitTypes;
    return [HealthcareBasicSections.PatientSummaryDocument.attributeValue];
  }

  private extractRequestedBundleType(body: any): string {
    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const queryIndex = requestUrl.indexOf('?');
      if (queryIndex < 0) continue;
      const params = new URLSearchParams(requestUrl.slice(queryIndex + 1));
      const bundleType = String(params.get('type') || '').trim();
      if (bundleType) return bundleType;
    }
    return '';
  }

  private extractSearchResourceType(body: any): string {
    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];
    for (const wrapper of wrappers) {
      const requestUrl = String(wrapper?.request?.url || '').trim();
      if (!requestUrl) continue;
      const target = extractSearchResourceTarget(requestUrl);
      if (!target) continue;
      return target.toLowerCase();
    }
    return 'composition';
  }

  private extractDocumentReferenceSearchFilters(body: any): {
    identifier?: string;
    attachmentHash?: string;
  } {
    const identifier = this.getFirstSearchFilter(body, ['identifier', 'documentreference.identifier']);
    const attachmentHash = this.getFirstSearchFilter(body, [
      'contenthash',
      'documentreference.contenthash',
      'attachment.hash',
    ]);
    return {
      identifier: identifier || undefined,
      attachmentHash: attachmentHash || undefined,
    };
  }

  private extractCommunicationSearchFilters(body: any): {
    identifier?: string;
    thid?: string;
    pthid?: string;
    attachmentHash?: string;
  } {
    const identifier = this.getFirstSearchFilter(body, ['identifier', 'communication.identifier']);
    const thid = this.getFirstSearchFilter(body, ['thid']);
    const pthid = this.getFirstSearchFilter(body, ['pthid']);
    const attachmentHash = this.getFirstSearchFilter(body, [
      'contenthash',
      'documentreference.contenthash',
      'attachment.hash',
    ]);
    return {
      identifier: identifier || undefined,
      thid: thid || undefined,
      pthid: pthid || undefined,
      attachmentHash: attachmentHash || undefined,
    };
  }

  private collectSearchFilters(body: any): SearchFilters {
    const filters: SearchFilters = {};
    const merge = (source: SearchFilters) => {
      for (const [key, values] of Object.entries(source)) {
        if (!filters[key]) {
          filters[key] = [];
        }
        filters[key].push(...values);
      }
    };

    if (Array.isArray(body?.parameter)) {
      merge(extractSearchFiltersFromParametersResource({ resourceType: 'Parameters', parameter: body.parameter }));
    }

    const wrappers = [
      ...(Array.isArray(body?.entry) ? body.entry : []),
      ...(Array.isArray(body?.data) ? body.data : []),
    ];

    for (const wrapper of wrappers) {
      merge(extractSearchFiltersFromRequestUrl(wrapper?.request?.url));
      if (wrapper?.resource?.resourceType === 'Parameters') {
        merge(extractSearchFiltersFromParametersResource(wrapper.resource));
      }
    }

    return filters;
  }

  private getSearchFilterValues(body: any, names: string[]): string[] {
    const filters = this.collectSearchFilters(body);
    const values: string[] = [];
    for (const name of names) {
      values.push(...(filters[name] || []));
    }
    return values.map((value) => String(value).trim()).filter(Boolean);
  }

  private getFirstSearchFilter(body: any, names: string[]): string {
    return this.getSearchFilterValues(body, names)[0] || '';
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

  private isIpsBundleDocumentRequest(
    searchResourceType: string,
    requestedBundleType: string,
    requiredTypes: string[],
  ): boolean {
    if (searchResourceType !== 'bundle') return false;
    if (String(requestedBundleType || '').trim().toLowerCase() !== 'document') return false;
    if (!Array.isArray(requiredTypes) || requiredTypes.length === 0) return false;

    const ipsCode = HealthcareBasicSections.PatientSummaryDocument.code;
    return requiredTypes.some((value) => this.extractTokenCode(value) === ipsCode);
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
    const compositionRecords = await this.vaultRepository.getContainersInSection(params.tenantVaultId, compositionSectionId);

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

      const authorReference = this.normalizeReference(getClaimValue<string>(compositionRecord, 'Composition.author'));
      if (authorReference) authorRefs.add(authorReference);
      const compositionDate = this.normalizeReference(getClaimValue<string>(compositionRecord, 'Composition.date'));
      if (compositionDate) compositionDates.push(compositionDate);
    }

    for (const sectionToken of includedSectionTokens) {
      const projectionConfigs = IPS_SECTION_PROJECTION_CONFIG[sectionToken] || [];
      for (const projectionConfig of projectionConfigs) {
        for (const sectionIdSuffix of projectionConfig.sectionIds) {
          const resourceSectionId = getSubjectScopedSectionId(params.subject, params.scope, sectionIdSuffix);
          const resourceRecords = await this.vaultRepository.getContainersInSection(params.tenantVaultId, resourceSectionId);
          for (const resourceRecord of resourceRecords) {
            const resource = this.buildFhirResourceFromIndexedClaims(projectionConfig.resourceType, resourceRecord);
            const entryKey = this.resolveEntryKey(undefined, resource);
            if (!bundleEntries.has(entryKey)) {
              bundleEntries.set(entryKey, {
                fullUrl: this.resolveBundleEntryFullUrl(undefined, { resource }),
                resource,
              });
            }
            this.addSectionReference(sectionRefs, sectionToken, entryKey);
          }
        }
      }
    }

    const documentReferenceSectionId = getSubjectScopedSectionId(params.subject, params.scope, 'document-references');
    const documentReferenceRecords = await this.vaultRepository.getContainersInSection(params.tenantVaultId, documentReferenceSectionId);
    for (const documentReferenceRecord of documentReferenceRecords) {
      const resource = this.buildFhirResourceFromIndexedClaims('DocumentReference', documentReferenceRecord);
      const entryKey = this.resolveEntryKey(undefined, resource);
      if (!bundleEntries.has(entryKey)) {
        bundleEntries.set(entryKey, {
          fullUrl: this.resolveBundleEntryFullUrl(undefined, { resource }),
          resource,
        });
      }
    }

    const compositionId = `ips-composition-${determineResourceId(params.subject, process.env.NODE_ENV)}`;
    const compositionResource: Record<string, any> = {
      resourceType: 'Composition',
      id: compositionId,
      status: 'final',
      type: {
        coding: [{
          system: HealthcareBasicSections.PatientSummaryDocument.system,
          code: HealthcareBasicSections.PatientSummaryDocument.code,
          display: 'Patient summary Document',
        }],
      },
      subject: { reference: params.subject },
      date: this.pickLatestIsoDate(compositionDates),
      title: 'International Patient Summary',
      section: Array.from(sectionRefs.entries()).map(([sectionToken, refs]) => ({
        code: {
          coding: [this.tokenToCoding(sectionToken)],
        },
        entry: Array.from(refs).map((reference) => ({ reference })),
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
          fullUrl: `Composition/${compositionId}`,
          resource: compositionResource,
        },
        ...Array.from(bundleEntries.entries()).map(([reference, entry]) => ({
          fullUrl: entry.fullUrl || reference,
          resource: entry.resource,
        })),
      ],
    };
  }

  private resolveEntryKey(reference: string | undefined, resource: Record<string, any>): string {
    return this.normalizeReference(reference)
      || this.normalizeReference(resource?.identifier?.[0]?.value)
      || this.normalizeReference(resource?.resourceType && resource?.id ? `${resource.resourceType}/${resource.id}` : '')
      || `${String(resource?.resourceType || 'Resource')}/${determineResourceId(String(resource?.id || randomUUID()), process.env.NODE_ENV)}`;
  }

  private resolveBundleEntryFullUrl(
    reference: string | undefined,
    entry: { fullUrl?: string; resource?: Record<string, any> },
  ): string | undefined {
    return this.normalizeReference(entry?.fullUrl)
      || this.normalizeReference(reference)
      || this.normalizeReference(entry?.resource?.identifier?.[0]?.value)
      || this.normalizeReference(
        entry?.resource?.resourceType && entry?.resource?.id
          ? `${entry.resource.resourceType}/${entry.resource.id}`
          : '',
      )
      || undefined;
  }

  private normalizeReference(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
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
    const actualCode = this.extractTokenCode(actualType);
    return requiredTypes.some((requiredType) => this.extractTokenCode(requiredType) === actualCode);
  }

  private extractTokenCode(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const parts = normalized.split('|');
    return parts.length > 1 ? parts[parts.length - 1] : normalized;
  }

  private tokenToCoding(value: string): { system?: string; code: string } {
    const normalized = String(value || '').trim();
    const [left, right] = normalized.split('|');
    if (!right) {
      return { code: left };
    }
    if (/^https?:\/\//i.test(left)) {
      return { system: left, code: right };
    }
    if (left.toUpperCase() === 'LOINC') {
      return { system: 'http://loinc.org', code: right };
    }
    return { system: left, code: right };
  }

  private pickLatestIsoDate(values: string[]): string {
    const sorted = values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort();
    return sorted[sorted.length - 1] || new Date().toISOString();
  }

  private buildFhirResourceFromIndexedClaims(resourceType: string, record: Record<string, any>): Record<string, any> {
    const claims = normalizeContextualizedClaims(record || {});
    const subject =
      this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.subject`))
      || this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.patient`));
    const identifier = this.normalizeReference(
      getClaimValue<string>(claims, `${resourceType}.identifier`)
      || getClaimValue<string>(claims, `${resourceType}.identifier.value`),
    );
    const codeToken = this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.code`));
    const status = this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.status`));
    const noteText = this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.note`));
    const effective = this.normalizeReference(
      getClaimValue<string>(claims, `${resourceType}.effective`)
      || getClaimValue<string>(claims, `${resourceType}.effectiveDateTime`)
      || getClaimValue<string>(claims, `${resourceType}.date`),
    );
    const codeText = this.normalizeReference(getClaimValue<string>(claims, `${resourceType}.code-text`));
    const medicationText = this.normalizeReference(getClaimValue<string>(claims, 'MedicationStatement.medication-text'));

    const resource: Record<string, any> = {
      resourceType,
      id: String(record?.id || determineResourceId(identifier || randomUUID(), process.env.NODE_ENV)),
      meta: {
        claims,
      },
    };

    if (identifier) {
      resource.identifier = [{ value: identifier }];
    }
    if (subject) {
      if (resourceType === 'AllergyIntolerance' || resourceType === 'Immunization' || resourceType === 'RelatedPerson') {
        resource.patient = { reference: subject };
      } else {
        resource.subject = { reference: subject };
      }
    }
    if (status) {
      resource.status = status;
    }
    if (effective) {
      if (resourceType === 'MedicationStatement') {
        resource.effectiveDateTime = effective;
      } else if (resourceType === 'Observation') {
        resource.effectiveDateTime = effective;
      } else if (resourceType === 'DocumentReference') {
        resource.date = effective;
      } else {
        resource.recordedDate = effective;
      }
    }
    if (noteText) {
      resource.note = [{ text: noteText }];
    }

    if (resourceType === 'MedicationStatement' && medicationText) {
      resource.medicationCodeableConcept = { text: medicationText };
    } else if (codeText || codeToken) {
      resource.code = {
        ...(codeText ? { text: codeText } : {}),
        ...(codeToken ? { coding: [this.tokenToCoding(codeToken)] } : {}),
      };
    }

    if (resourceType === 'DocumentReference') {
      const contentType = this.normalizeReference(getClaimValue<string>(claims, 'DocumentReference.contenttype'));
      const description = this.normalizeReference(getClaimValue<string>(claims, 'DocumentReference.description'));
      const contentHash = this.normalizeReference(getClaimValue<string>(claims, 'DocumentReference.contenthash'));
      const location = this.normalizeReference(getClaimValue<string>(claims, 'DocumentReference.location'));
      if (description) resource.description = description;
      resource.content = [{
        attachment: {
          ...(contentType ? { contentType } : {}),
          ...(location ? { url: location } : {}),
          ...(contentHash ? { id: contentHash } : {}),
        },
      }];
      if (subject) {
        resource.subject = { reference: subject };
      }
      if (effective) {
        resource.date = effective;
      }
    }

    return resource;
  }

  private filterMatchesBySectionsAndTypes(
    matches: any[],
    requiredSections: string[],
    excludedSections: string[],
    requiredTypes: string[],
  ): any[] {
    if (!Array.isArray(matches)) return [];
    const hasSectionFilter = Array.isArray(requiredSections) && requiredSections.length > 0;
    const hasExcludedSectionFilter = Array.isArray(excludedSections) && excludedSections.length > 0;
    const hasTypeFilter = Array.isArray(requiredTypes) && requiredTypes.length > 0;
    if (!hasSectionFilter && !hasExcludedSectionFilter && !hasTypeFilter) return matches;

    const requiredSectionSet = new Set(requiredSections.map((s) => String(s || '').trim()).filter(Boolean));
    const excludedSectionSet = new Set(excludedSections.map((s) => String(s || '').trim()).filter(Boolean));
    const requiredTypeSet = new Set(requiredTypes.map((s) => String(s || '').trim()).filter(Boolean));

    return matches.filter((record: any) => {
      if (hasSectionFilter || hasExcludedSectionFilter) {
        const sectionKeys = [
          'Composition.section',
          'org.hl7.fhir.r4.Composition.section',
          'org.hl7.fhir.api.Composition.section',
        ];
        let sectionValue = '';
        for (const key of sectionKeys) {
          const candidate = String(record?.[key] || '').trim();
          if (candidate) {
            sectionValue = candidate;
            break;
          }
        }
        if (!sectionValue) return false;
        const gotSections = new Set(sectionValue.split(',').map((v: string) => v.trim()).filter(Boolean));

        if (hasExcludedSectionFilter) {
          for (const excluded of excludedSectionSet) {
            if (gotSections.has(excluded)) {
              return false;
            }
          }
        }

        if (hasSectionFilter) {
          let sectionMatched = false;
          for (const req of requiredSectionSet) {
            if (gotSections.has(req)) {
              sectionMatched = true;
              break;
            }
          }
          if (!sectionMatched) return false;
        }
      }

      if (hasTypeFilter) {
        const typeKeys = [
          'Composition.type',
          'org.hl7.fhir.r4.Composition.type',
          'org.hl7.fhir.api.Composition.type',
        ];
        let typeValue = '';
        for (const key of typeKeys) {
          const candidate = String(record?.[key] || '').trim();
          if (candidate) {
            typeValue = candidate;
            break;
          }
        }
        if (!typeValue) return false;
        const gotTypes = new Set(typeValue.split(',').map((v: string) => v.trim()).filter(Boolean));
        let typeMatched = false;
        for (const req of requiredTypeSet) {
          if (gotTypes.has(req)) {
            typeMatched = true;
            break;
          }
        }
        if (!typeMatched) return false;
      }

      return true;
    });
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
      const documentReferences = await this.vaultRepository.getContainersInSection(tenantVaultId, documentReferenceSectionId);
      allowedDocumentReferences = new Set(
        documentReferences
          .filter((record: any) => {
            const attachmentHash = String(
              record?.['DocumentReference.contenthash']
                || record?.['org.hl7.fhir.r4.DocumentReference.contenthash']
                || '',
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
