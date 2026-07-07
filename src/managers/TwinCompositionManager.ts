import { randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import {
  DataCollectionIds,
  HealthcareSummarySections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { buildFhirClaimKeys, getClaimValue, getFirstClaimValueByKeys, stripKnownFhirClaimContextPrefix } from '../utils/claims';
import { getEnvSectionId } from '../utils/section-env';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { getTenantVaultId } from '../utils/tenant';
import {
  collectSearchFiltersFromBody,
  getSearchFilterValues,
  SearchFilters,
} from '../utils/search-request';
import { SUBJECT_SECTION_DIGITAL_TWIN } from '../constants/domain';
import { GatewayEnvelopeTypes, GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { BundleType } from '../utils/bundle';
import type { IJobProcessor } from './registry';

export type TwinCompositionProjectionConfig = {
  collectionIds: string[];
  resourceType: string;
};

export const TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG: Readonly<
Record<string, readonly TwinCompositionProjectionConfig[]>
> = Object.freeze({
  [HealthcareSummarySections.HistoryOfMedicationUse.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.medications], resourceType: ResourceTypesFhirR4.MedicationStatement },
  ]),
  [HealthcareSummarySections.AllergiesAndIntolerances.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.allergies], resourceType: ResourceTypesFhirR4.AllergyIntolerance },
  ]),
  [HealthcareSummarySections.ProblemList.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.Results.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
    { collectionIds: [DataCollectionIds.diagnosticReports], resourceType: ResourceTypesFhirR4.DiagnosticReport },
  ]),
  [HealthcareSummarySections.Procedures.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.procedures], resourceType: ResourceTypesFhirR4.Procedure },
  ]),
  [HealthcareSummarySections.Immunizations.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.immunizations], resourceType: ResourceTypesFhirR4.Immunization },
  ]),
  [HealthcareSummarySections.FunctionalStatus.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.PlanOfCare.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.carePlans], resourceType: ResourceTypesFhirR4.CarePlan },
  ]),
  [HealthcareSummarySections.PlanOfTreatment.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.carePlans], resourceType: ResourceTypesFhirR4.CarePlan },
  ]),
  [HealthcareSummarySections.SocialHistory.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.VitalSigns.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.AdvanceDirectives.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.consents], resourceType: ResourceTypesFhirR4.Consent },
  ]),
  [HealthcareSummarySections.HistoryOfPastIllness.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.PregnancyHistory.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.GoalsAndPreferences.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.consents], resourceType: ResourceTypesFhirR4.Consent },
  ]),
  [HealthcareSummarySections.Alert.attributeValue]: Object.freeze([]),
  [HealthcareSummarySections.MedicalDevices.attributeValue]: Object.freeze([]),
});

/**
 * Dedicated manager for digital twin `Composition` search semantics.
 *
 * It owns the section-first fan-out from IPS summary sections to internal
 * resource-family collections and the claims-backed matching behavior used by
 * `digitaltwin/.../Composition/_search`.
 */
export class TwinCompositionManager {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly compositionFallbackManager?: IJobProcessor,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (job.action !== '_search') {
      if (!this.compositionFallbackManager) {
        throw new Error('TwinCompositionManager requires a composition fallback manager for non-search actions.');
      }
      return this.compositionFallbackManager.process(job);
    }

    const tenantVaultId = getTenantVaultId(String(job.sector || ''), String(job.tenantId || ''));
    const body = job.content?.body as any;
    const searchSections = this.getSearchFilterValues(body, ['section', 'composition.section']);
    const excludedSections = this.getSearchFilterValues(body, ['section:not', 'composition.section:not']);
    const matches = await this.searchBySectionAndClaims({
      tenantVaultId,
      requiredSections: searchSections,
      excludedSections,
      body,
      filterMatchesBySectionsAndTypes: (records, required, excluded) =>
        records.filter((record) => {
          const sectionToken = String(
            getFirstClaimValueByKeys(record, buildFhirClaimKeys('Composition.section')) || '',
          ).trim();
          if (!sectionToken) return false;
          if (excluded.includes(sectionToken)) return false;
          if (required.length > 0 && !required.includes(sectionToken)) return false;
          return true;
        }),
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

  public collectSearchFilters(body: any): SearchFilters {
    return collectSearchFiltersFromBody(body);
  }

  private getSearchFilterValues(body: any, names: string[]): string[] {
    return getSearchFilterValues(body, names);
  }

  public async searchBySectionAndClaims(params: {
    tenantVaultId: string;
    requiredSections: string[];
    excludedSections: string[];
    body: any;
    filterMatchesBySectionsAndTypes: (matches: any[], requiredSections: string[], excludedSections: string[], requiredTypes: string[]) => any[];
  }): Promise<any[]> {
    if (!Array.isArray(params.requiredSections) || params.requiredSections.length === 0) {
      throw new Error('digitaltwin Composition/_search requires at least one section filter.');
    }

    const filters = this.collectSearchFilters(params.body);
    const requestedResourceTypes = new Set<string>();
    for (const key of Object.keys(filters)) {
      const match = /^([A-Za-z][A-Za-z0-9]*)\./.exec(String(key || '').trim());
      if (match?.[1]) requestedResourceTypes.add(match[1]);
    }
    if (requestedResourceTypes.size === 0) {
      throw new Error('digitaltwin Composition/_search requires at least one resource-scoped claim filter.');
    }
    if (requestedResourceTypes.size > 1) {
      throw new Error('digitaltwin Composition/_search currently supports one resource type per request.');
    }

    const requestedResourceType = Array.from(requestedResourceTypes)[0]!;
    if (requestedResourceType === ResourceTypesFhirR4.Composition) {
      return this.searchCompositionRecordsByDirectFilters({
        tenantVaultId: params.tenantVaultId,
        requiredSections: params.requiredSections,
        excludedSections: params.excludedSections,
        filters,
        filterMatchesBySectionsAndTypes: params.filterMatchesBySectionsAndTypes,
      });
    }

    const allSections = await this.vaultRepository.getAllSections(params.tenantVaultId);
    const matchedSubjects = new Set<string>();

    for (const sectionToken of params.requiredSections) {
      if (params.excludedSections.includes(sectionToken)) continue;
      const projectionConfigs = TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || [];
      for (const projectionConfig of projectionConfigs) {
        if (projectionConfig.resourceType !== requestedResourceType) continue;
        for (const collectionId of projectionConfig.collectionIds) {
          const normalizedCollectionId = String(collectionId || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          const prefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_${normalizedCollectionId}_`);
          const candidateSectionIds = allSections.filter((sectionId) => String(sectionId || '').startsWith(prefix));
          for (const candidateSectionId of candidateSectionIds) {
            const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, candidateSectionId);
            for (const record of records) {
              if (!this.matchesResourceFilters(record, requestedResourceType, filters)) continue;
              const subject = this.normalizeReference(
                getClaimValue<string>(record, `${requestedResourceType}.subject`)
                || getClaimValue<string>(record, `${requestedResourceType}.patient`),
              );
              if (subject) matchedSubjects.add(subject);
            }
          }
        }
      }
    }

    const compositionMatches: any[] = [];
    for (const subject of matchedSubjects) {
      const compositionSectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_DIGITAL_TWIN, DataCollectionIds.composition);
      const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, compositionSectionId);
      compositionMatches.push(
        ...params.filterMatchesBySectionsAndTypes(
          records,
          params.requiredSections,
          params.excludedSections,
          [],
        ),
      );
    }

    return compositionMatches;
  }

  private async searchCompositionRecordsByDirectFilters(params: {
    tenantVaultId: string;
    requiredSections: string[];
    excludedSections: string[];
    filters: SearchFilters;
    filterMatchesBySectionsAndTypes: (matches: any[], requiredSections: string[], excludedSections: string[], requiredTypes: string[]) => any[];
  }): Promise<any[]> {
    const allSections = await this.vaultRepository.getAllSections(params.tenantVaultId);
    const compositionSectionPrefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_${DataCollectionIds.composition}_`);
    const candidateSectionIds = allSections.filter((sectionId) =>
      String(sectionId || '').startsWith(compositionSectionPrefix),
    );

    const compositionMatches: any[] = [];
    for (const candidateSectionId of candidateSectionIds) {
      const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, candidateSectionId);
      const sectionMatches = params.filterMatchesBySectionsAndTypes(
        records,
        params.requiredSections,
        params.excludedSections,
        [],
      );
      compositionMatches.push(
        ...sectionMatches.filter((record) => this.matchesCompositionFilters(record, params.filters)),
      );
    }

    return compositionMatches;
  }

  private matchesCompositionFilters(record: Record<string, any>, filters: SearchFilters): boolean {
    const relevantEntries = Object.entries(filters).filter(([key, values]) =>
      String(key || '').startsWith(`${ResourceTypesFhirR4.Composition}.`) && Array.isArray(values) && values.length > 0,
    );
    if (relevantEntries.length === 0) return false;

    return relevantEntries.every(([claimName, values]) => {
      const normalizedClaimName = stripKnownFhirClaimContextPrefix(String(claimName || '').trim()).toLowerCase();
      if (normalizedClaimName === 'composition.meta-tag' || normalizedClaimName === 'composition.meta.tag') {
        return values.every((expectedValue) => this.matchesCompositionMetaTag(record, expectedValue));
      }

      const actualValue = this.readClaimValue(record, claimName);
      if (!actualValue) return false;
      return values.every((expectedValue) => this.matchesClaimValue(claimName, actualValue, expectedValue));
    });
  }

  private matchesResourceFilters(
    record: Record<string, any>,
    resourceType: string,
    filters: SearchFilters,
  ): boolean {
    const relevantEntries = Object.entries(filters).filter(([key, values]) =>
      String(key || '').startsWith(`${resourceType}.`) && Array.isArray(values) && values.length > 0,
    );
    if (relevantEntries.length === 0) return false;

    return relevantEntries.every(([claimName, values]) => {
      const actualValue = this.readClaimValue(record, claimName);
      if (!actualValue) return false;
      return values.every((expectedValue) => this.matchesClaimValue(claimName, actualValue, expectedValue));
    });
  }

  private readClaimValue(record: Record<string, any>, claimName: string): string {
    const normalizedClaimName = stripKnownFhirClaimContextPrefix(String(claimName || '').trim());
    const resourceType = normalizedClaimName.split('.')[0] || '';
    const candidateClaimNames = [
      ...buildFhirClaimKeys(normalizedClaimName),
      normalizedClaimName.replace(/\.code-display$/i, '.CodeDisplay'),
      normalizedClaimName.replace(/\.code-text-local$/i, '.CodeTextLocal'),
      normalizedClaimName.replace(/\.code-text$/i, '.CodeTextLocal'),
      normalizedClaimName.replace(/\.code-text$/i, '.code-text'),
      ...(resourceType === ResourceTypesFhirR4.MedicationStatement && normalizedClaimName.endsWith('.code-text')
        ? ['MedicationStatement.medication-text']
        : []),
    ];

    for (const candidateClaimName of candidateClaimNames) {
      const candidateValue = this.normalizeReference(getClaimValue<string>(record, candidateClaimName));
      if (candidateValue) return candidateValue;
    }

    return '';
  }

  private matchesClaimValue(claimName: string, actualValue: string, expectedValue: string): boolean {
    const normalizedActual = String(actualValue || '').trim();
    const normalizedExpected = String(expectedValue || '').trim();
    if (!normalizedActual || !normalizedExpected) return false;

    const normalizedClaimName = String(claimName || '').trim().toLowerCase();
    if (
      normalizedClaimName.endsWith('.code-display')
      || normalizedClaimName.endsWith('.codedisplay')
      || normalizedClaimName.endsWith('.code-text')
      || normalizedClaimName.endsWith('.code-text-local')
      || normalizedClaimName.endsWith('.codetextlocal')
      || normalizedClaimName.endsWith('.medication-text')
      || normalizedClaimName.endsWith('.note')
    ) {
      return normalizedActual.toLowerCase().includes(normalizedExpected.toLowerCase());
    }

    return normalizedActual === normalizedExpected;
  }

  private matchesCompositionMetaTag(record: Record<string, any>, expectedValue: string): boolean {
    const normalizedExpected = String(expectedValue || '').trim();
    if (!normalizedExpected) return false;

    const [expectedSystem, expectedCode] = normalizedExpected.includes('|')
      ? normalizedExpected.split('|', 2).map((value) => String(value || '').trim())
      : ['', normalizedExpected];
    if (!expectedCode) return false;

    return this.collectResearchTags(record).some((tag) => {
      const actualSystem = String(tag?.system || '').trim();
      const actualCode = String(tag?.code || '').trim();
      if (!actualCode) return false;
      if (expectedSystem) {
        return actualSystem === expectedSystem && actualCode === expectedCode;
      }
      return actualCode === expectedCode;
    });
  }

  private collectResearchTags(record: Record<string, any>): Array<{ system?: string; code?: string }> {
    const directTags = Array.isArray(record?.tag) ? record.tag : [];
    const metaTags = Array.isArray(record?.meta?.tag) ? record.meta.tag : [];
    const uniqueTags = new Map<string, { system?: string; code?: string }>();
    for (const rawTag of [...directTags, ...metaTags]) {
      if (!rawTag || typeof rawTag !== 'object') continue;
      const system = String((rawTag as any).system || '').trim();
      const code = String((rawTag as any).code || '').trim();
      if (!system && !code) continue;
      uniqueTags.set(`${system}|${code}`, { system, code });
    }
    return Array.from(uniqueTags.values());
  }

  private normalizeReference(value: string | undefined): string {
    return String(value || '').trim();
  }
}
