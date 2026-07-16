// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/CommunicationManager.ts
// Description: Manager for handling business logic related to FHIR Communications.

import { CommMsgExtended, DataEntry, FhirCommunication } from 'gdc-common-utils-ts/models/comm';
import {
  DataCollectionIds,
  FhirResourceTypeDataCollections,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { claimsToContentCid } from 'gdc-common-utils-ts/utils/fhir-cid';
import {
  buildCommunicationParticipantIndexAttributes,
  matchesCommunicationParticipantSearch,
  paginateCommunicationParticipantMatches,
  parseCommunicationParticipantSearchCriteria,
} from 'gdc-common-utils-ts/utils/communication-participant-search';
import { SearchBundleTypes } from 'gdc-common-utils-ts/utils/fhir-search';
import { GatewayLocalFhirResourceTypes } from '../shared/fhir-constants';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { determineResourceId } from '../utils/resource';
import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import type { ITenantsManager } from './ITenantsManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { getEnvSectionId } from '../utils/section-env';
import { createHash } from 'crypto';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { applyFhirCidVersioningToEntry, fhirResourceToCid } from '../utils/fhir-versioning';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { persistConsentRuleAndAttachment } from '../utils/consent-storage';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';

type SupportedProjectedResourceType =
  | 'MedicationStatement'
  | 'Observation'
  | 'AllergyIntolerance'
  | 'Condition'
  | 'Procedure'
  | 'ImagingStudy'
  | 'Immunization'
  | 'RelatedPerson'
  | 'DiagnosticReport'
  | 'CarePlan'
  | 'Encounter'
  | 'AdverseEvent'
  | 'Consent';

type ProjectionConfig = {
  collectionId: string;
  subjectClaimKeys: string[];
  identifierClaimKeys: string[];
};

type ResolvedCommunicationAttachment = {
  transportAttachment: Record<string, any>;
  documentReference?: Record<string, any>;
  documentAttachment: Record<string, any>;
};

const PROJECTED_RESOURCE_CONFIG: Record<SupportedProjectedResourceType, ProjectionConfig> = {
  MedicationStatement: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.MedicationStatement],
    subjectClaimKeys: ['MedicationStatement.subject', 'MedicationStatement.patient'],
    identifierClaimKeys: ['MedicationStatement.identifier', 'MedicationStatement.identifier.value'],
  },
  Observation: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Observation],
    subjectClaimKeys: ['Observation.subject', 'Observation.patient'],
    identifierClaimKeys: ['Observation.identifier', 'Observation.identifier.value'],
  },
  AllergyIntolerance: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.AllergyIntolerance],
    subjectClaimKeys: ['AllergyIntolerance.patient', 'AllergyIntolerance.subject'],
    identifierClaimKeys: ['AllergyIntolerance.identifier', 'AllergyIntolerance.identifier.value'],
  },
  Condition: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Condition],
    subjectClaimKeys: ['Condition.subject', 'Condition.patient'],
    identifierClaimKeys: ['Condition.identifier', 'Condition.identifier.value'],
  },
  Procedure: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Procedure],
    subjectClaimKeys: ['Procedure.subject', 'Procedure.patient'],
    identifierClaimKeys: ['Procedure.identifier', 'Procedure.identifier.value'],
  },
  ImagingStudy: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.ImagingStudy],
    subjectClaimKeys: ['ImagingStudy.subject', 'ImagingStudy.patient'],
    identifierClaimKeys: ['ImagingStudy.identifier', 'ImagingStudy.identifier.value'],
  },
  Immunization: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Immunization],
    subjectClaimKeys: ['Immunization.patient', 'Immunization.subject'],
    identifierClaimKeys: ['Immunization.identifier', 'Immunization.identifier.value'],
  },
  RelatedPerson: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.RelatedPerson],
    subjectClaimKeys: ['RelatedPerson.patient', 'RelatedPerson.subject'],
    identifierClaimKeys: ['RelatedPerson.identifier', 'RelatedPerson.identifier.value'],
  },
  DiagnosticReport: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.DiagnosticReport],
    subjectClaimKeys: ['DiagnosticReport.subject', 'DiagnosticReport.patient'],
    identifierClaimKeys: ['DiagnosticReport.identifier', 'DiagnosticReport.identifier.value'],
  },
  CarePlan: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.CarePlan],
    subjectClaimKeys: ['CarePlan.subject', 'CarePlan.patient'],
    identifierClaimKeys: ['CarePlan.identifier', 'CarePlan.identifier.value'],
  },
  Encounter: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Encounter],
    subjectClaimKeys: ['Encounter.subject', 'Encounter.patient'],
    identifierClaimKeys: ['Encounter.identifier', 'Encounter.identifier.value'],
  },
  AdverseEvent: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.AdverseEvent],
    subjectClaimKeys: ['AdverseEvent.subject', 'AdverseEvent.patient'],
    identifierClaimKeys: ['AdverseEvent.identifier', 'AdverseEvent.identifier.value'],
  },
  Consent: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Consent],
    subjectClaimKeys: ['Consent.subject', 'Consent.patient'],
    identifierClaimKeys: ['Consent.identifier', 'Consent.identifier.value'],
  },
};

interface CommunicationManagerOptions {
  tenantsCacheManager: ITenantsManager;
  vaultRepository: IVaultRepository;
  compositionManager?: IJobProcessor;
  individualManager?: IJobProcessor;
}

const COMMUNICATION_RESOURCE_TYPE = 'Communication' as const;
const COMMUNICATION_ENTRY_TYPE = 'CommMsgExtended' as const;
const COMMUNICATION_SECTION_NAME = DataCollectionIds.communications;
const FHIR_PARAMETERS_RESOURCE_TYPE = GatewayLocalFhirResourceTypes.Parameters;
const SEARCH_RESPONSE_ENTRY_TYPE = GatewayResponseEntryTypes.CommunicationSearch;
const COMMUNICATION_SECTION_PREFIX = getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_${COMMUNICATION_SECTION_NAME}_`);

/**
 * Processes the canonical `Communication` transport envelope used by the
 * operational `individual` flows.
 *
 * Architectural intent:
 * - `individual` is the operational subject-index plane.
 * - The public read model for `individual` is not "one `_search` endpoint per
 *   clinical resource type".
 * - Instead, `Communication` carries the auditable request envelope and may
 *   embed references to:
 *   - `Subject/$summary` for canonical subject-summary retrieval
 *   - `Subject/_search` for structured subject-location requests
 *   - `Bundle/_search` for document/section retrieval
 *
 * The same manager also projects attached document content into internal
 * subject-scoped storage sections so later summary/document retrieval can be
 * resolved deterministically.
 *
 * Important boundary:
 * - `individual` is for operational subject reads and document retrieval.
 * - `digitaltwin` is a different plane with different search semantics.
 * - `digitaltwin` should not be documented as "the same thing as individual
 *   but under another path".
 */
export class CommunicationManager implements IJobProcessor {
  private readonly tenantsCacheManager: ITenantsManager;
  private readonly vaultRepository: IVaultRepository;
  private readonly compositionManager?: IJobProcessor;
  private readonly individualManager?: IJobProcessor;

  constructor({ tenantsCacheManager, vaultRepository, compositionManager, individualManager }: CommunicationManagerOptions) {
    this.tenantsCacheManager = tenantsCacheManager;
    this.vaultRepository = vaultRepository;
    this.compositionManager = compositionManager;
    this.individualManager = individualManager;
  }

  /**
   * Processes a job request containing FHIR Communication resources.
   * It iterates through the input entries, converts them, and prepares them for storage/delivery.
   * @param job The job to process.
   * @returns A promise that resolves to a payload response containing the converted messages.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (job.action === '_search') {
      return this.processSearch(job);
    }

    const bundleEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const now = Math.floor(Date.now() / 1000);

    if (!job.content) {
      throw new Error('Job content is missing');
    }

    const body = job.content.body as any;
    const entries: any[] =
      (Array.isArray(body?.data) && body.data) ||
      (Array.isArray(body?.entry) && body.entry) ||
      [body];

    for (const entry of entries) {
      try {
        const fhirResource: FhirCommunication | undefined = (entry as any).resource
          ? (entry as any).resource
          : this.buildFhirCommunicationFromClaims((entry as any)?.meta?.claims);

        if (!fhirResource) {
          throw new Error('Malformed entry: missing resource and missing meta.claims');
        }
        
        if (fhirResource.resourceType !== COMMUNICATION_RESOURCE_TYPE) {
          console.warn(`Skipping resource of type ${fhirResource.resourceType}`);
          continue;
        }

        const serverDid = await this.tenantsCacheManager.getTenantDid(getTenantVaultId(job.sector as string, job.tenantId as string));
        if (!serverDid) {
            throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
        }
        const commMsg = this.convertFhirToCommMsg(job.content.thid, serverDid, fhirResource);
        await this.persistCommunicationChannelRecord(job, entry as any, fhirResource, commMsg);
        await this.persistCompositionProjectionFromCommunication(job, entry as any, fhirResource, serverDid);
        await this.persistDocumentReferenceProjectionFromCommunication(job, entry as any, fhirResource);
        await this.persistProjectedResourcesFromCommunication(job, entry as any, fhirResource);

        const embeddedSearchResponseEntries = await this.executeEmbeddedSearchRequest(job, fhirResource);
        if (embeddedSearchResponseEntries && embeddedSearchResponseEntries.length > 0) {
          bundleEntries.push(...embeddedSearchResponseEntries);
          continue;
        }

        const identifierClaim =
          (entry as any)?.meta?.claims?.[CommunicationClaim.Identifier] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        
        bundleEntries.push({
          response: { status: '200' },
          id: resourceId,
          type: COMMUNICATION_ENTRY_TYPE,
          resource: commMsg,
        });

      } catch (error) {
        const identifierClaim =
          (entry as any)?.meta?.claims?.[CommunicationClaim.Identifier] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        bundleEntries.push({
          response: {
            status: '500',
            outcome: {
              resourceType: GatewayLocalFhirResourceTypes.OperationOutcome,
              issue: [{
                severity: 'error',
                code: 'processing',
                details: { text: error instanceof Error ? error.message : 'Unknown error during conversion.' },
              }],
            }
          },
          id: resourceId,
          type: GatewayResponseEntryTypes.OperationOutcome,
          meta: entry.meta,
        });
      }
    }

    const responseBundle: BundleJsonApi<BundleEntryResponse | ErrorEntry> = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: `${job.action}-response`, // FHIR based: batch-resonse, transaction-response
      data: bundleEntries,
    };
    
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const serverDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!serverDid) {
      // This is a critical configuration error. The tenant is not in the cache.
      // We cannot issue a response without a valid DID.
      throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
    }

    // The audience of our response should be the issuer of the request
    const aud = job.content.meta?.bearer?.jwt?.payload?.iss || '';

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      iss: serverDid,
      aud: aud,
      exp: now + 300, // 5 minutes expiration
      thid: job.content.thid,
      type: 'api+json',
      body: responseBundle,
    };
    return result;
  }

  private async processSearch(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const now = Math.floor(Date.now() / 1000);
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const serverDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!serverDid) {
      throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
    }

    const criteria = parseCommunicationParticipantSearchCriteria(
      this.extractSearchBody(job),
    );
    const records = await this.searchCommunicationChannelRecords(tenantVaultId, criteria);
    const pagedRecords = paginateCommunicationParticipantMatches(records, criteria);
    const data: Array<BundleEntryResponse | ErrorEntry> = pagedRecords.map((record) => ({
      response: { status: '200' },
      id: this.normalizeOptionalString(record.id) || determineResourceId(record[CommunicationClaim.Identifier], process.env.NODE_ENV),
      type: COMMUNICATION_ENTRY_TYPE,
      meta: {
        claims: this.buildSearchResponseClaims(record),
      },
      resource: record.resource || record,
    }));

    const responseBundle: BundleJsonApi<BundleEntryResponse | ErrorEntry> = {
      resourceType: 'Bundle',
      type: SearchBundleTypes.SearchResponse,
      total: records.length,
      data,
    };

    return {
      jti: uuidv4(),
      iss: serverDid,
      aud: job.content?.meta?.bearer?.jwt?.payload?.iss || '',
      exp: now + 300,
      thid: this.normalizeOptionalString(job.content?.thid) || uuidv4(),
      type: 'api+json',
      body: responseBundle,
    };
  }

  private async executeEmbeddedSearchRequest(
    job: JobRequest,
    fhirResource: FhirCommunication,
  ): Promise<Array<BundleEntryResponse | ErrorEntry> | undefined> {
    const references = this.buildCommunicationContentReferences(job, undefined, fhirResource)
      .filter((reference) => this.isEmbeddedSearchReference(reference));
    if (references.length === 0) return undefined;

    const responseEntries: Array<BundleEntryResponse | ErrorEntry> = [];
    for (const reference of references) {
      const parsed = this.parseEmbeddedSearchReference(reference, job, fhirResource);
      if (!parsed) continue;
      const targetManager = parsed.resourceType === 'Subject' && parsed.action === '_search'
        ? this.individualManager
        : this.compositionManager;
      if (!targetManager) continue;

      const syntheticJob: JobRequest = {
        ...job,
        section: parsed.section,
        format: parsed.format,
        resourceType: parsed.resourceType,
        action: parsed.action,
        content: {
          ...(job.content as any),
          body: parsed.body,
        } as any,
      };

      const searchResponse = await targetManager.process(syntheticJob);
      const searchEntries = Array.isArray((searchResponse.body as any)?.data)
        ? ((searchResponse.body as any).data as Array<BundleEntryResponse | ErrorEntry>)
        : [];
      responseEntries.push(...searchEntries);
    }

    return responseEntries.length > 0 ? responseEntries : undefined;
  }

  private isEmbeddedSearchReference(reference: string): boolean {
    const normalized = String(reference || '').trim().toLowerCase();
    if (!normalized) return false;
    return this.isBundleSearchReference(normalized)
      || this.isSummaryOperationReference(normalized)
      || this.isSubjectSearchReference(normalized);
  }

  private isBundleSearchReference(reference: string): boolean {
    return reference.includes('/bundle/_search?') || reference.startsWith('bundle/_search?') || reference.startsWith('bundle?');
  }

  private isSummaryOperationReference(reference: string): boolean {
    return reference.includes('/subject/$summary')
      || reference.includes('/patient/$summary')
      || reference.includes('/researchsubject/$summary')
      || reference.startsWith('subject/$summary')
      || reference.startsWith('patient/$summary')
      || reference.startsWith('researchsubject/$summary');
  }

  private isSubjectSearchReference(reference: string): boolean {
    return reference.includes('/subject/_search')
      || reference.startsWith('subject/_search')
      || reference.includes('/patient/_search')
      || reference.startsWith('patient/_search');
  }

  private parseEmbeddedSearchReference(
    reference: string,
    fallbackJob: JobRequest,
    fhirResource: FhirCommunication,
  ): { section: string; format: string; resourceType: string; action: string; body: Record<string, unknown> } | undefined {
    const normalized = String(reference || '').trim();
    if (!normalized) return undefined;

    let pathname = normalized;
    let search = '';
    if (/^https?:\/\//i.test(normalized)) {
      const parsed = new URL(normalized);
      pathname = parsed.pathname;
      search = parsed.search || '';
    } else {
      const syntheticUrl = new URL(normalized.startsWith('/') ? normalized : `/${normalized}`, 'http://internal.local');
      pathname = syntheticUrl.pathname;
      search = syntheticUrl.search || '';
    }

    const cleanPath = pathname.replace(/^\/+/, '');
    const segments = cleanPath.split('/').filter(Boolean);
    if (segments.length < 2) return undefined;

    let section = String(fallbackJob.section || '').trim() || SUBJECT_SECTION_INDIVIDUAL;
    let format = String(fallbackJob.format || '').trim();

    const directIndex = segments.findIndex((segment) => segment === SUBJECT_SECTION_INDIVIDUAL || segment === 'digitaltwin');
    if (directIndex >= 0 && segments.length >= directIndex + 4) {
      section = segments[directIndex];
      format = segments[directIndex + 1];
    } else if (segments.length >= 4) {
      section = segments[0];
      format = segments[1];
    }

    const query = search.startsWith('?') ? search.slice(1) : search;
    const normalizedPath = cleanPath.toLowerCase();
    if (this.isSummaryOperationReference(normalizedPath)) {
      const summaryResourceType = normalizedPath.includes('researchsubject/$summary')
        ? 'ResearchSubject'
        : 'Subject';
      return {
        section,
        format,
        resourceType: summaryResourceType,
        action: '$summary',
        body: this.buildSummaryParametersBody(query),
      };
    }

    if (this.isSubjectSearchReference(normalizedPath)) {
      return {
        section,
        format,
        resourceType: 'Subject',
        action: '_search',
        body: this.buildSubjectSearchBody(query, fhirResource),
      };
    }

    const requestUrl = `Bundle${query ? `?${query}` : ''}`;
    return {
      section,
      format,
      resourceType: 'Bundle',
      action: '_search',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: {
              method: 'GET',
              url: requestUrl,
            },
          },
        ],
      },
    };
  }

  private buildSummaryParametersBody(query: string): Record<string, unknown> {
    const params = new URLSearchParams(query);
    const parameter: Array<Record<string, unknown>> = [];
    const parameterNameByQueryKey: Record<string, string> = {
      subject: 'subject',
      'composition.subject': 'subject',
      'document-type': 'document-type',
      'composition.type': 'document-type',
      section: 'section',
      'composition.section': 'section',
      'section:not': 'exclude-section',
      'composition.section:not': 'exclude-section',
      'exclude-section': 'exclude-section',
      'exclude-sections': 'exclude-section',
    };

    for (const [key, rawValue] of params.entries()) {
      const parameterName = parameterNameByQueryKey[String(key || '').trim().toLowerCase()];
      const value = String(rawValue || '').trim();
      if (!parameterName || !value) continue;
      parameter.push({
        name: parameterName,
        valueString: value,
      });
    }

    return {
      resourceType: 'Parameters',
      parameter,
    };
  }

  private buildSubjectSearchBody(query: string, fhirResource: FhirCommunication): Record<string, unknown> {
    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const attachment = payload?.contentAttachment;
    const dataBase64 = String(attachment?.data || '').trim();
    if (dataBase64) {
      try {
        return JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8'));
      } catch {
        // Fall through to query-string conversion.
      }
    }

    const params = new URLSearchParams(query);
    const parameter: Array<Record<string, unknown>> = [];
    for (const [key, rawValue] of params.entries()) {
      const name = String(key || '').trim().toLowerCase();
      const value = String(rawValue || '').trim();
      if (!value) continue;
      parameter.push({
        name,
        valueString: value,
      });
    }

    return {
      resourceType: 'Parameters',
      parameter,
    };
  }

  private async persistCompositionProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    serverDid: string,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const rawSubject =
      (entry?.meta?.claims?.[CommunicationClaim.Subject] as string | undefined)
      || (entry?.resource?.meta?.claims?.[CommunicationClaim.Subject] as string | undefined)
      || (fhirResource?.subject as any)?.reference
      || '';
    const subject = String(rawSubject || '').replace(/^Patient\//i, '').trim();
    if (!subject) return;

    const claimsSection = String(
      (entry?.meta?.claims?.['Composition.section'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Composition.section'] as string | undefined)
      || '',
    ).trim();
    const claimsType = String(
      (entry?.meta?.claims?.['Composition.type'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Composition.type'] as string | undefined)
      || '',
    ).trim();
    const payloadComposition = this.extractCompositionResourceFromCommunicationPayload(fhirResource);
    const embeddedClaims = payloadComposition?.meta?.claims && typeof payloadComposition.meta.claims === 'object'
      ? normalizeContextualizedClaims(payloadComposition.meta.claims as Record<string, any>)
      : undefined;
    const payloadSections = this.extractCompositionSectionsFromCommunicationPayload(fhirResource);
    const payloadSection = payloadSections[0];
    const payloadType = this.extractCompositionTypeFromCommunicationPayload(fhirResource);
    const sectionCodes = Array.from(new Set([
      claimsSection,
      ...payloadSections,
      payloadSection,
      HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const typeCode = claimsType || payloadType || HealthcareBasicSections.PatientSummaryDocument.attributeValue;

    const sent = String(
      (entry?.meta?.claims?.[CommunicationClaim.Sent] as string | undefined)
      || (entry?.resource?.meta?.claims?.[CommunicationClaim.Sent] as string | undefined)
      || fhirResource?.sent
      || new Date().toISOString(),
    );

    const compositionIdentifier =
      this.normalizeOptionalString(payloadComposition?.identifier?.[0]?.value)
      || this.getFirstClaimValue(embeddedClaims || {}, ['Composition.identifier', 'Composition.identifier.value'])
      || this.normalizeOptionalString(payloadComposition?.id)
      || `urn:uuid:${uuidv4()}`;
    const fallbackId =
      this.normalizeOptionalString(payloadComposition?.id)
      || determineResourceId(compositionIdentifier, process.env.NODE_ENV);

    for (const sectionCode of sectionCodes) {
      const claims = normalizeContextualizedClaims({
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': compositionIdentifier,
        'Composition.subject': subject,
        'Composition.section': sectionCode,
        'Composition.author': serverDid,
        'Composition.date': sent,
        'Composition.type': typeCode,
        'Composition.source': 'Communication',
      });
      if (embeddedClaims) {
        Object.assign(claims, embeddedClaims, { 'Composition.section': sectionCode });
      }
      applyFhirCidVersioningToEntry({
        entry: payloadComposition ? { resource: payloadComposition } : { resource: { resourceType: 'Composition', id: fallbackId } },
        claims,
        resourceType: 'Composition',
        resourceId: fallbackId,
      });
      const contentVersionId = claimsToContentCid(claims).cid;
      claims['Composition.meta.versionId'] = contentVersionId;
      claims['org.hl7.fhir.r4.Composition.meta.versionId'] = contentVersionId;

      const individualSectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, 'composition');
      const digitalTwinSectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_DIGITAL_TWIN, 'composition');
      const versionId = this.normalizeOptionalString(
        claims['Composition.meta.versionId']
        || claims['org.hl7.fhir.r4.Composition.meta.versionId'],
      );
      if (versionId) {
        const exists = await this.hasSectionRecordWithClaims(tenantVaultId, individualSectionId, [
          { name: 'Composition.meta.versionId', value: versionId },
        ]);
        if (exists) continue;
      }
      const recordId = this.buildStableProjectionRecordId(
        'composition-from-communication',
        `${compositionIdentifier}|${sectionCode}`,
      );
      const record = { id: recordId, ...claims } as any;
      await this.vaultRepository.put(tenantVaultId, [record], individualSectionId);
      await this.vaultRepository.put(tenantVaultId, [record], digitalTwinSectionId);
    }
  }

  private async persistCommunicationChannelRecord(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    commMsg: CommMsgExtended,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const subject = this.resolveCommunicationSubject(entry, fhirResource);
    if (!subject) return;

    const messageId =
      this.resolveCommunicationIdentifier(entry, fhirResource)
      || this.normalizeOptionalString(commMsg.id)
      || this.normalizeOptionalString((job.content as any)?.jti);
    if (!messageId) return;
    const threadId = this.normalizeOptionalString(job.content?.thid) || this.normalizeOptionalString(commMsg.thid);

    const sent =
      this.resolveCommunicationSent(entry, fhirResource)
      || (commMsg.created_time ? new Date(commMsg.created_time * 1000).toISOString() : undefined)
      || new Date().toISOString();

    const noteText = Array.isArray(fhirResource.note)
      ? fhirResource.note
        .map((note) => String(note?.text || '').trim())
        .filter(Boolean)
        .join('\n')
      : '';
    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];
    const attachmentCount = payloads.filter((payload: any) => payload?.contentAttachment && typeof payload.contentAttachment === 'object').length;
    const contentReferences = this.buildCommunicationContentReferences(job, entry, fhirResource);

    const record: Record<string, any> = {
      id: messageId,
      type: COMMUNICATION_ENTRY_TYPE,
      thid: threadId,
      pthid: String(job.content?.pthid || commMsg.pthid || '').trim() || undefined,
      from: commMsg.from,
      to: commMsg.to,
      indexed: {
        attributes: buildCommunicationParticipantIndexAttributes({
          subject,
          sender: this.resolveCommunicationSender(entry, fhirResource) || commMsg.from,
          recipients: this.resolveCommunicationRecipient(entry, fhirResource) || commMsg.to,
          from: commMsg.from,
          to: commMsg.to,
        }),
      },
      created_time: commMsg.created_time,
      audit: {
        created: sent,
        updated: sent,
        channel: 'communication',
      },
      resource: commMsg,
      [CommunicationClaim.Identifier]: this.resolveCommunicationIdentifier(entry, fhirResource),
      [CommunicationClaim.Subject]: subject,
      [CommunicationClaim.Recipient]: this.resolveCommunicationRecipient(entry, fhirResource),
      [CommunicationClaim.Sender]: this.resolveCommunicationSender(entry, fhirResource),
      [CommunicationClaim.Sent]: sent,
      [CommunicationClaim.NoteText]: noteText || undefined,
      meta: {
        payloadCount: payloads.length,
        documentReferenceCount: attachmentCount,
      },
    };
    if (contentReferences.length > 0) {
      record[CommunicationClaim.ContentReference] = contentReferences.join(',');
    }

    const sectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, COMMUNICATION_SECTION_NAME);
    await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
  }

  private extractCompositionSectionsFromCommunicationPayload(fhirResource: FhirCommunication): string[] {
    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const fromCodeableConcept = payload?.contentCodeableConcept?.coding?.[0];
    if (fromCodeableConcept?.system && fromCodeableConcept?.code) {
      return [this.toCanonicalCodingToken(fromCodeableConcept.system, fromCodeableConcept.code)];
    }

    const resolvedAttachment = this.resolveCommunicationPayloadAttachment(payload);
    const contentType = String(resolvedAttachment?.documentAttachment?.contentType || '').toLowerCase();
    const encodedData = String(resolvedAttachment?.documentAttachment?.data || '').trim();
    if (!encodedData || !contentType.includes('json')) return [];

    try {
      const decoded = Buffer.from(encodedData, 'base64').toString('utf8');
      const parsed = this.parseDocumentBundle(decoded);
      if (!parsed) return [];
      const compositionEntry = parsed.entry.find((e: any) => e?.resource?.resourceType === 'Composition');
      const sectionCodes = Array.isArray(compositionEntry?.resource?.section)
        ? compositionEntry.resource.section
          .map((section: any) => {
            const sectionCoding = section?.code?.coding?.[0];
            return sectionCoding?.system && sectionCoding?.code
              ? this.toCanonicalCodingToken(sectionCoding.system, sectionCoding.code)
              : '';
          })
          .filter(Boolean)
        : [];
      if (sectionCodes.length > 0) return sectionCodes;
    } catch {
      return [];
    }
    return [];
  }

  private extractCompositionTypeFromCommunicationPayload(fhirResource: FhirCommunication): string | undefined {
    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const resolvedAttachment = this.resolveCommunicationPayloadAttachment(payload);
    const contentType = String(resolvedAttachment?.documentAttachment?.contentType || '').toLowerCase();
    const encodedData = String(resolvedAttachment?.documentAttachment?.data || '').trim();
    if (!encodedData || !contentType.includes('json')) return undefined;

    try {
      const decoded = Buffer.from(encodedData, 'base64').toString('utf8');
      const parsed = this.parseDocumentBundle(decoded);
      if (!parsed) return undefined;
      const compositionEntry = parsed.entry.find((e: any) => e?.resource?.resourceType === 'Composition');
      const coding = compositionEntry?.resource?.type?.coding?.[0];
      if (coding?.system && coding?.code) {
        return this.toCanonicalCodingToken(coding.system, coding.code);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private toCanonicalCodingToken(system: string, code: string): string {
    const normalizedSystem = String(system || '').trim();
    const normalizedCode = String(code || '').trim();
    if (!normalizedSystem || !normalizedCode) return '';
    if (normalizedSystem === 'http://loinc.org') {
      return `LOINC|${normalizedCode}`;
    }
    return `${normalizedSystem}|${normalizedCode}`;
  }

  private async persistDocumentReferenceProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const nowIso = new Date().toISOString();
    const subject = this.resolveCommunicationSubject(entry, fhirResource);
    if (!subject) return;
    const communicationSent = this.resolveCommunicationSent(entry, fhirResource) || nowIso;

    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];
    for (const payload of payloads) {
      const resolvedAttachment = this.resolveCommunicationPayloadAttachment(payload);
      const attachment = resolvedAttachment?.documentAttachment;
      if (!attachment) continue;

      const contentType = String(attachment.contentType || 'application/octet-stream').trim();
      const dataBase64 = typeof attachment.data === 'string' ? attachment.data.trim() : '';
      const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
      if (!dataBase64 && !url) continue;

      const cid = this.deriveAttachmentCid({
        attachmentId: typeof attachment.id === 'string' ? attachment.id : undefined,
        contentType,
        dataBase64: dataBase64 || undefined,
        url: url || undefined,
      });
      if (!cid) continue;

      const documentReference = resolvedAttachment.documentReference;
      const embeddedClaims = documentReference?.meta?.claims && typeof documentReference.meta.claims === 'object'
        ? normalizeContextualizedClaims(documentReference.meta.claims as Record<string, any>)
        : undefined;
      const documentIdentifier =
        this.normalizeOptionalString(documentReference?.identifier?.[0]?.value)
        || this.getFirstClaimValue(embeddedClaims || {}, ['DocumentReference.identifier', 'DocumentReference.identifier.value'])
        || `urn:uuid:${uuidv4()}`;
      const claims = normalizeContextualizedClaims({
        '@context': 'org.hl7.fhir.r4',
        'DocumentReference.identifier': documentIdentifier,
        'DocumentReference.contenthash': cid,
        'DocumentReference.subject': this.normalizeOptionalString(documentReference?.subject?.reference)?.replace(/^Patient\//i, '').trim() || subject,
        'DocumentReference.contenttype': contentType,
        'DocumentReference.date': this.normalizeOptionalString(documentReference?.date) || String(communicationSent),
      });
      if (embeddedClaims) {
        Object.assign(claims, embeddedClaims);
      }
      if (url) (claims as Record<string, string>)['DocumentReference.location'] = url;
      const description =
        this.normalizeOptionalString(documentReference?.description)
        || this.normalizeOptionalString(attachment.title)
        || this.getFirstClaimValue(claims, ['DocumentReference.description']);
      if (description) {
        (claims as Record<string, string>)['DocumentReference.description'] = description;
      }

      const sectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, 'document-references');
      const alreadyIndexed = await this.hasSectionRecordWithClaims(tenantVaultId, sectionId, [
        { name: 'DocumentReference.contenthash', value: cid },
      ]);
      if (alreadyIndexed) continue;
      const recordId = this.buildStableProjectionRecordId('documentreference-from-communication', cid);
      await this.vaultRepository.put(tenantVaultId, [{ id: recordId, ...claims } as any], sectionId);
    }
  }

  private deriveAttachmentCid(params: {
    attachmentId?: string;
    contentType?: string;
    dataBase64?: string;
    url?: string;
  }): string | undefined {
    const attachmentId = String(params.attachmentId || '').trim();
    if (attachmentId.startsWith('z') && attachmentId.length > 10) return attachmentId;

    const contentType = String(params.contentType || '').toLowerCase();
    const dataBase64 = String(params.dataBase64 || '').trim();
    if (contentType.includes('fhir') && dataBase64) {
      try {
        const parsed = JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8'));
        if (parsed && typeof parsed === 'object') {
          return fhirResourceToCid(parsed as Record<string, unknown>).cid;
        }
      } catch {
      }
    }

    if (dataBase64) {
      try {
        const bytes = Buffer.from(dataBase64, 'base64');
        return this.rawBytesToCid(bytes);
      } catch {
        return undefined;
      }
    }

    const url = String(params.url || '').trim();
    if (url) return this.rawBytesToCid(Buffer.from(url, 'utf8'));
    return undefined;
  }

  private rawBytesToCid(input: Uint8Array): string {
    const digest = createHash('sha256').update(input).digest();
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
    const cidBytes = Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from([0x55]),
      multihash,
    ]);
    return encodeMultibase58btc(new Uint8Array(cidBytes));
  }

  private buildStableProjectionRecordId(prefix: string, identity: string): string {
    const digest = createHash('sha256').update(String(identity || ''), 'utf8').digest('hex');
    return `${prefix}-${digest}`;
  }

  private async hasSectionRecordWithClaims(
    tenantVaultId: string,
    sectionId: string,
    where: Array<{ name: string; value: string }>,
  ): Promise<boolean> {
    if (!Array.isArray(where) || where.length === 0) return false;
    const matches = await this.vaultRepository.query(tenantVaultId, { sectionId, where }, { hydrate: false });
    return Array.isArray(matches) && matches.length > 0;
  }

  private async persistProjectedResourcesFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const communicationSubject = this.resolveCommunicationSubject(entry, fhirResource);
    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];
    for (const payload of payloads) {
      const attachment = this.resolveCommunicationPayloadAttachment(payload)?.documentAttachment;
      const resources = this.extractProjectedFhirResourcesFromAttachment(attachment);
      for (const resource of resources) {
        const resourceType = this.getSupportedProjectedResourceType(resource?.resourceType);
        if (!resource || !resourceType) continue;

        const config = PROJECTED_RESOURCE_CONFIG[resourceType];
        const claims = this.extractProjectedResourceClaims(resourceType, resource, communicationSubject, fhirResource);
        const subjectRef = this.resolveProjectedResourceSubject(claims, config.subjectClaimKeys);
        if (!subjectRef) continue;

        const identifier =
          this.getFirstClaimValue(claims, config.identifierClaimKeys)
          || `urn:uuid:${uuidv4()}`;
        const fallbackId = determineResourceId(identifier, process.env.NODE_ENV);
        const claimsVersionId = claimsToContentCid(claims).cid;
        applyFhirCidVersioningToEntry({
          entry: { resource },
          claims,
          resourceType,
          resourceId: fallbackId,
        });
        // Claims-first resources can have identical sparse FHIR shells while
        // carrying different clinical meaning in meta.claims. Deduplicate by
        // the canonical claims CID, not by the bare resource shell CID.
        claims[`${resourceType}.meta.versionId`] = claimsVersionId;
        claims[`org.hl7.fhir.r4.${resourceType}.meta.versionId`] = claimsVersionId;
        const versionId = claimsVersionId;

        const sectionId = getSubjectScopedSectionId(subjectRef, SUBJECT_SECTION_INDIVIDUAL, config.collectionId);
        if (versionId) {
          const alreadyIndexed = await this.hasSectionRecordWithClaims(tenantVaultId, sectionId, [
            { name: `${resourceType}.meta.versionId`, value: versionId },
          ]);
          if (alreadyIndexed) continue;
        }

        const recordId = String(resource?.id || versionId || fallbackId);
        const record: Record<string, any> = {
          id: recordId,
          ...claims,
          indexed: { attributes: this.buildIndexedAttributesFromClaims(claims) },
        };
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        const digitalTwinSectionId = getSubjectScopedSectionId(subjectRef, SUBJECT_SECTION_DIGITAL_TWIN, config.collectionId);
        await this.vaultRepository.put(tenantVaultId, [record as any], digitalTwinSectionId);
        if (resourceType === 'Consent' && this.getFirstClaimValue(claims, ['Consent.decision', 'org.hl7.fhir.api.Consent.decision'])) {
          await persistConsentRuleAndAttachment({
            vaultRepository: this.vaultRepository,
            tenantVaultId,
            sector: String(job.sector || ''),
            claims,
          });
        }
      }
    }
  }

  private getSupportedProjectedResourceType(resourceType: unknown): SupportedProjectedResourceType | undefined {
    if (typeof resourceType !== 'string') return undefined;
    return Object.prototype.hasOwnProperty.call(PROJECTED_RESOURCE_CONFIG, resourceType)
      ? resourceType as SupportedProjectedResourceType
      : undefined;
  }

  private resolveProjectedResourceSubject(
    claims: Record<string, any>,
    claimKeys: string[],
  ): string | undefined {
    const subject = this.getFirstClaimValue(claims, claimKeys);
    return subject?.replace(/^Patient\//i, '').trim() || undefined;
  }

  private resolveProjectedResourceCanonicalSubject(
    resourceSubjectRef: string | undefined,
    communicationSubject: string | undefined,
  ): string {
    const normalizedResourceSubject = String(resourceSubjectRef || '').replace(/^Patient\//i, '').trim();
    const normalizedCommunicationSubject = String(communicationSubject || '').replace(/^Patient\//i, '').trim();
    if (!normalizedResourceSubject) return normalizedCommunicationSubject;
    if (!normalizedCommunicationSubject) return normalizedResourceSubject;

    const looksLikeLocalBundleSubject =
      /^urn:/i.test(normalizedResourceSubject)
      || /^https?:\/\//i.test(normalizedResourceSubject)
      || /^Patient\//i.test(String(resourceSubjectRef || '').trim());
    return looksLikeLocalBundleSubject ? normalizedCommunicationSubject : normalizedResourceSubject;
  }

  private getFirstClaimValue(claims: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = getClaimValue<string>(claims, key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private extractProjectedResourceClaims(
    resourceType: SupportedProjectedResourceType,
    resource: Record<string, any>,
    communicationSubject: string | undefined,
    fhirResource: FhirCommunication,
  ): Record<string, any> {
    const rawMetaClaims = resource?.meta?.claims;
    if (rawMetaClaims && typeof rawMetaClaims === 'object' && !Array.isArray(rawMetaClaims)) {
      return normalizeContextualizedClaims(rawMetaClaims as Record<string, any>);
    }

    const baseClaims: Record<string, any> = {
      '@context': 'org.hl7.fhir.api',
    };

    const resourceSubjectRef = String(
      resource?.subject?.reference
      || resource?.patient?.reference
      || '',
    ).trim();
    const subjectRef = this.resolveProjectedResourceCanonicalSubject(resourceSubjectRef, communicationSubject);
    if (subjectRef) {
      baseClaims[`${resourceType}.subject`] = subjectRef;
      if (resourceType === 'AllergyIntolerance' || resourceType === 'Immunization' || resourceType === 'RelatedPerson') {
        baseClaims[`${resourceType}.patient`] = subjectRef;
      }
    }

    const identifierValue = String(resource?.identifier?.[0]?.value || '').trim();
    if (identifierValue) baseClaims[`${resourceType}.identifier`] = identifierValue;

    const statusValue = String(resource?.status || '').trim();
    if (statusValue) baseClaims[`${resourceType}.status`] = statusValue;

    const language = String(resource?.language || (fhirResource as any)?.language || '').trim();
    if (language) baseClaims[`${resourceType}.language`] = language;

    const codeableText = String(
      resource?.code?.text
      || resource?.medicationCodeableConcept?.text
      || resource?.vaccineCode?.text
      || resource?.category?.[0]?.text
      || '',
    ).trim();
    if (codeableText) {
      const claimName = resourceType === 'MedicationStatement' ? 'medication-text' : 'code-text';
      baseClaims[`${resourceType}.${claimName}`] = codeableText;
    }

    const codeCoding = resource?.code?.coding?.[0]
      || resource?.medicationCodeableConcept?.coding?.[0]
      || resource?.vaccineCode?.coding?.[0]
      || resource?.category?.[0]?.coding?.[0];
    const codeDisplay = String(codeCoding?.display || '').trim();
    if (codeDisplay) {
      baseClaims[`${resourceType}.CodeDisplay`] = codeDisplay;
    }
    if (codeableText) {
      baseClaims[`${resourceType}.CodeTextLocal`] = codeableText;
    }
    const codeSystem = String(codeCoding?.system || '').trim();
    const codeValue = String(codeCoding?.code || '').trim();
    if (codeValue) {
      baseClaims[`${resourceType}.code`] = codeSystem ? `${codeSystem}|${codeValue}` : codeValue;
    }
    const userSelectedRaw = codeCoding?.userSelected;
    if (typeof userSelectedRaw === 'boolean') {
      baseClaims[`${resourceType}.user-selected`] = String(userSelectedRaw);
    }

    const noteText = String(resource?.note?.[0]?.text || '').trim();
    if (noteText) baseClaims[`${resourceType}.note`] = noteText;

    const effectiveDateTime = String(
      resource?.effectiveDateTime
      || resource?.onsetDateTime
      || resource?.occurrenceDateTime
      || resource?.occurrencePeriod?.start
      || resource?.performedDateTime
      || resource?.issued
      || resource?.recordedDate
      || resource?.authoredOn
      || resource?.start
      || '',
    ).trim();
    if (effectiveDateTime) {
      const claimName =
        resourceType === 'MedicationStatement' ? 'effective' :
        resourceType === 'Observation' ? 'effectiveDateTime' :
        'date';
      baseClaims[`${resourceType}.${claimName}`] = effectiveDateTime;
    }

    if (resourceType === 'MedicationStatement') {
      if (!baseClaims['MedicationStatement.user-selected']) {
        baseClaims['MedicationStatement.user-selected'] = 'true';
      }
    }

    return normalizeContextualizedClaims(baseClaims);
  }

  private buildIndexedAttributesFromClaims(
    claims: Record<string, any>,
  ): Array<{ name: string; value: string; unique?: boolean }> {
    const attributes: Array<{ name: string; value: string; unique?: boolean }> = [];
    for (const [key, value] of Object.entries(claims)) {
      if (key === '@context' || key === '@type' || value === undefined || value === null || Array.isArray(value)) {
        continue;
      }
      const normalized = String(value).trim();
      if (!normalized) continue;
      attributes.push({
        name: key,
        value: normalized,
        unique: key.endsWith('.identifier') || key.endsWith('.identifier.value'),
      });
    }
    return attributes;
  }

  private extractSearchBody(job: JobRequest): Record<string, unknown> {
    const body = job.content?.body as Record<string, any> | undefined;
    if (!body || typeof body !== 'object') {
      return { resourceType: FHIR_PARAMETERS_RESOURCE_TYPE, parameter: [] };
    }
    if (body.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE) {
      return body;
    }
    if (Array.isArray(body.entry)) {
      const parameterResource = body.entry.find((entry) => entry?.resource?.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE)?.resource;
      if (parameterResource && typeof parameterResource === 'object') {
        return parameterResource;
      }
    }
    return body;
  }

  private async searchCommunicationChannelRecords(
    tenantVaultId: string,
    criteria: ReturnType<typeof parseCommunicationParticipantSearchCriteria>,
  ): Promise<Array<Record<string, any>>> {
    const sectionIds = await this.resolveCommunicationSearchSectionIds(tenantVaultId, criteria);
    const recordsById = new Map<string, Record<string, any>>();

    for (const sectionId of sectionIds) {
      const records = await this.vaultRepository.listContainersInSection<any>(tenantVaultId, sectionId);
      for (const record of records) {
        if (String(record?.type || '').trim() !== COMMUNICATION_ENTRY_TYPE) {
          continue;
        }
        if (!matchesCommunicationParticipantSearch({
          subject: record?.[CommunicationClaim.Subject],
          sender: record?.[CommunicationClaim.Sender] || record?.from,
          recipients: record?.[CommunicationClaim.Recipient] || record?.to,
          from: record?.from,
          to: record?.to,
          sent: record?.[CommunicationClaim.Sent],
          category: record?.[CommunicationClaim.Category],
          topic: record?.[CommunicationClaim.Topic],
        }, criteria)) {
          continue;
        }
        const stableId = this.normalizeOptionalString(record.id)
          || this.normalizeOptionalString(record[CommunicationClaim.Identifier])
          || determineResourceId(record?.thid, process.env.NODE_ENV);
        if (!recordsById.has(stableId)) {
          recordsById.set(stableId, record);
        }
      }
    }

    return Array.from(recordsById.values()).sort((left, right) => {
      const leftSent = this.normalizeOptionalString(left?.[CommunicationClaim.Sent]) || '';
      const rightSent = this.normalizeOptionalString(right?.[CommunicationClaim.Sent]) || '';
      return leftSent.localeCompare(rightSent);
    });
  }

  private async resolveCommunicationSearchSectionIds(
    tenantVaultId: string,
    criteria: ReturnType<typeof parseCommunicationParticipantSearchCriteria>,
  ): Promise<string[]> {
    if (!criteria.anySubject && criteria.subjectActorIds.length > 0) {
      return criteria.subjectActorIds.map((subjectActorId) =>
        getSubjectScopedSectionId(subjectActorId, SUBJECT_SECTION_INDIVIDUAL, COMMUNICATION_SECTION_NAME));
    }

    const sectionIds = await this.vaultRepository.getAllSections(tenantVaultId);
    return sectionIds.filter((sectionId) => String(sectionId || '').startsWith(COMMUNICATION_SECTION_PREFIX));
  }

  private buildSearchResponseClaims(record: Record<string, any>): Record<string, unknown> {
    return {
      '@context': 'org.hl7.fhir.r4',
      [CommunicationClaim.Identifier]: this.normalizeOptionalString(record[CommunicationClaim.Identifier]) || this.normalizeOptionalString(record.id),
      [CommunicationClaim.Subject]: this.normalizeOptionalString(record[CommunicationClaim.Subject]),
      [CommunicationClaim.Sender]: this.normalizeOptionalString(record[CommunicationClaim.Sender]) || this.normalizeOptionalString(record.from),
      [CommunicationClaim.Recipient]: this.normalizeOptionalString(record[CommunicationClaim.Recipient])
        || this.joinSearchResponseRecipients(record.to),
      [CommunicationClaim.Sent]: this.normalizeOptionalString(record[CommunicationClaim.Sent]),
      ...(this.normalizeOptionalString(record[CommunicationClaim.NoteText])
        ? { [CommunicationClaim.NoteText]: this.normalizeOptionalString(record[CommunicationClaim.NoteText]) }
        : {}),
      ...(this.normalizeOptionalString(record.thid)
        ? { [CommunicationClaim.PartOf]: this.normalizeOptionalString(record.thid) }
        : {}),
    };
  }

  private joinSearchResponseRecipients(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || '').trim()).filter(Boolean).join(',');
      return joined || undefined;
    }
    return this.normalizeOptionalString(value);
  }

  private extractCommunicationNoteTexts(fhirResource: FhirCommunication): string[] {
    if (!Array.isArray(fhirResource.note)) return [];
    return fhirResource.note
      .map((note) => String(note?.text || '').trim())
      .filter(Boolean);
  }

  private resolveAtomicNoteTexts(payloadCount: number, noteTexts: string[]): Array<string | undefined> {
    if (payloadCount <= 0) return [];
    if (noteTexts.length === 0) return Array.from({ length: payloadCount }, () => undefined);
    if (payloadCount === 1) return [noteTexts.join('\n\n')];
    if (noteTexts.length === 1) return Array.from({ length: payloadCount }, () => noteTexts[0]);
    if (noteTexts.length === payloadCount) return noteTexts.map((noteText) => noteText || undefined);
    return Array.from({ length: payloadCount }, () => noteTexts.join('\n\n'));
  }

  private buildAtomicDataEntry(
    type: DataEntry['type'],
    resource: Record<string, any>,
    noteText?: string,
  ): DataEntry {
    const entryResource = { ...resource };
    const claims: Record<string, any> = {};
    if (noteText) {
      claims[CommunicationClaim.NoteText] = noteText;
      claims[CommunicationClaim.Text] = noteText;
    }

    return {
      type,
      id: uuidv4(),
      resource: entryResource,
      ...(Object.keys(claims).length > 0 ? { meta: { claims } } : {}),
    };
  }

  /**
   * Converts a FHIR R4 Communication resource into a CommMsgExtended object.
   * (The rest of the method remains the same)
   */
   // ... [rest of the convertFhirToCommMsg method] ...
   public convertFhirToCommMsg(thid: string, fromDid: string, fhirResource: FhirCommunication): CommMsgExtended {
    const bodyData: DataEntry[] = [];
    const noteTexts = this.extractCommunicationNoteTexts(fhirResource);

    // Process `payload` into `Reference` and `Attachment` objects
    if (fhirResource.payload) {
      const atomicNotes = this.resolveAtomicNoteTexts(fhirResource.payload.length, noteTexts);
      fhirResource.payload.forEach((pld, index) => {
        const noteText = atomicNotes[index];
        if (pld.contentReference?.reference) {
          bodyData.push(this.buildAtomicDataEntry(
            'Reference',
            {
              reference: pld.contentReference.reference,
              type: 'Appointment', // This could be made dynamic if needed
            },
            noteText,
          ));
        } else if (pld.contentAttachment?.contentType || pld.contentAttachment?.data || pld.contentAttachment?.title) {
          bodyData.push(this.buildAtomicDataEntry(
            'Attachment',
            {
              contentType: pld.contentAttachment.contentType,
              data: pld.contentAttachment.data,
              title: pld.contentAttachment.title,
            },
            noteText,
          ));
        }
      });
    }

    if (bodyData.length === 0 && noteTexts.length > 0) {
      noteTexts.forEach((noteText) => {
        bodyData.push({
          type: 'Annotation',
          id: uuidv4(),
          resource: { text: noteText },
          meta: {
            claims: {
              [CommunicationClaim.NoteText]: noteText,
              [CommunicationClaim.Text]: noteText,
            },
          },
        });
      });
    }
    
    // Helper function to flatten arrays of CodeableConcepts into a single string
    const flattenCodeableConcept = (concepts: any[]): string | undefined => {
      if (!concepts || concepts.length === 0) return undefined;
      return concepts
        .map(concept => concept.coding?.[0] ? `${concept.coding[0].system}|${concept.coding[0].code}` : '')
        .filter(Boolean)
        .join(',');
    };

    // Helper function to flatten arrays of References into a single string
    const flattenReference = (refs: any[]): string | undefined => {
      if (!refs || refs.length === 0) return undefined;
      return refs.map(ref => ref.reference).filter(Boolean).join(',');
    };
    
    return {
      id: uuidv4(),
      type: 'https://didcomm.org/v2/communication', // Standard DIDComm message type for basic communication
      thid: thid,
      to: fhirResource.recipient?.map((ref) => ref.reference).filter((v): v is string => typeof v === 'string' && v.length > 0),
      from: fromDid,
      created_time: fhirResource.sent ? Math.floor(new Date(fhirResource.sent).getTime() / 1000) : undefined,
      body: {
        data: bodyData,
      },
      
      // Flattened FHIR attributes for metadata purposes (currently commented out as per plan)
      // status: fhirResource.status,
      // statusReason: flattenCodeableConcept(fhirResource.statusReason),
      // partOf: flattenReference(fhirResource.partOf),
      // basedOn: flattenReference(fhirResource.basedOn),
      // inResponseTo: flattenReference(fhirResource.inResponseTo),
      // priority: fhirResource.priority,
      // topic: flattenCodeableConcept(fhirResource.topic ? [fhirResource.topic] : []),
      // medium: flattenCodeableConcept(fhirResource.medium),
      // about: flattenReference(fhirResource.about),
      // encounter: fhirResource.encounter?.reference,
    };
  }

  private buildFhirCommunicationFromClaims(claims: Record<string, any> | undefined): FhirCommunication | undefined {
    if (!claims || typeof claims !== 'object') return undefined;

    const sent = claims[CommunicationClaim.Sent];
    const subject = claims[CommunicationClaim.Subject];
    const recipient = claims[CommunicationClaim.Recipient];
    const sender = claims[CommunicationClaim.Sender];
    const text = claims[CommunicationClaim.Text];

    const toRefs = typeof recipient === 'string'
      ? recipient.split(',').map((r: string) => r.trim()).filter(Boolean).map((reference: string) => ({ reference }))
      : Array.isArray(recipient)
        ? recipient.map((r) => (typeof r === 'string' ? ({ reference: r }) : r)).filter(Boolean)
        : undefined;

    const senderRef =
      typeof sender === 'string'
        ? { reference: sender }
        : sender && typeof sender === 'object' && typeof sender.reference === 'string'
          ? sender
          : undefined;

    return {
      resourceType: 'Communication',
      status: 'completed',
      sent: typeof sent === 'string' ? sent : undefined,
      subject: typeof subject === 'string' ? { reference: subject } : undefined,
      recipient: toRefs,
      sender: senderRef,
      note: typeof text === 'string' ? [{ text }] : undefined,
    } as unknown as FhirCommunication;
  }

  private resolveCommunicationIdentifier(entry: any, fhirResource: FhirCommunication): string | undefined {
    const resourceIdentifier = Array.isArray((fhirResource as any)?.identifier)
      ? (fhirResource as any).identifier.find((item: any) => typeof item?.value === 'string')?.value
      : undefined;
    return this.normalizeOptionalString(
      entry?.meta?.claims?.[CommunicationClaim.Identifier]
      || entry?.resource?.meta?.claims?.[CommunicationClaim.Identifier]
      || resourceIdentifier
      || (fhirResource as any)?.id,
    );
  }

  private resolveCommunicationSubject(entry: any, fhirResource: FhirCommunication): string | undefined {
    const raw = this.normalizeOptionalString(
      entry?.meta?.claims?.[CommunicationClaim.Subject]
      || entry?.resource?.meta?.claims?.[CommunicationClaim.Subject]
      || (fhirResource?.subject as any)?.reference,
    );
    return raw?.replace(/^Patient\//i, '').trim();
  }

  private resolveCommunicationRecipient(entry: any, fhirResource: FhirCommunication): string | undefined {
    const claimValue = entry?.meta?.claims?.[CommunicationClaim.Recipient] || entry?.resource?.meta?.claims?.[CommunicationClaim.Recipient];
    if (typeof claimValue === 'string' && claimValue.trim()) return claimValue.trim();
    const recipients = Array.isArray(fhirResource?.recipient)
      ? fhirResource.recipient.map((recipient) => String(recipient?.reference || '').trim()).filter(Boolean)
      : [];
    return recipients.length > 0 ? recipients.join(',') : undefined;
  }

  private resolveCommunicationSender(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.meta?.claims?.[CommunicationClaim.Sender]
      || entry?.resource?.meta?.claims?.[CommunicationClaim.Sender]
      || (fhirResource?.sender as any)?.reference,
    );
  }

  private resolveCommunicationSent(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.meta?.claims?.[CommunicationClaim.Sent]
      || entry?.resource?.meta?.claims?.[CommunicationClaim.Sent]
      || (fhirResource as any)?.sent,
    );
  }

  private buildCommunicationContentReferences(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): string[] {
    const references: string[] = [];
    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];

    for (const payload of payloads) {
      const contentReference = this.normalizeOptionalString(payload?.contentReference?.reference);
      if (contentReference) references.push(contentReference);

      const attachment = this.resolveCommunicationPayloadAttachment(payload)?.documentAttachment;
      if (!attachment) continue;

      const contentType = String(attachment.contentType || 'application/octet-stream').trim();
      const dataBase64 = typeof attachment.data === 'string' ? attachment.data.trim() : '';
      const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
      if (!dataBase64 && !url) continue;

      const cid = this.deriveAttachmentCid({
        attachmentId: typeof attachment.id === 'string' ? attachment.id : undefined,
        contentType,
        dataBase64: dataBase64 || undefined,
        url: url || undefined,
      });
      if (!cid) continue;

      const recordId = `documentreference-from-communication-${determineResourceId(String(cid), process.env.NODE_ENV)}`;
      references.push(`DocumentReference/${recordId}`);
    }

    return Array.from(new Set(references.filter(Boolean)));
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  }

  private resolveCommunicationPayloadAttachment(payload: any): ResolvedCommunicationAttachment | undefined {
    const transportAttachment = payload?.contentAttachment;
    if (!transportAttachment || typeof transportAttachment !== 'object') return undefined;

    const parsed = this.parseAttachmentJson(transportAttachment);
    if (parsed?.resourceType === 'DocumentReference') {
      const documentAttachment = parsed?.content?.[0]?.attachment;
      if (documentAttachment && typeof documentAttachment === 'object') {
        return {
          transportAttachment,
          documentReference: parsed as Record<string, any>,
          documentAttachment,
        };
      }
    }

    return {
      transportAttachment,
      documentAttachment: transportAttachment,
    };
  }

  private parseAttachmentJson(attachment: Record<string, any>): any | undefined {
    const contentType = String(attachment?.contentType || '').toLowerCase();
    const dataBase64 = typeof attachment?.data === 'string' ? attachment.data.trim() : '';
    if (!dataBase64 || !contentType.includes('json')) return undefined;
    try {
      return JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private extractProjectedFhirResourcesFromAttachment(attachment: Record<string, any> | undefined): Array<Record<string, any>> {
    if (!attachment || typeof attachment !== 'object') return [];
    const parsed = this.parseAttachmentJson(attachment);
    if (!parsed || typeof parsed !== 'object') return [];

    const documentBundle = this.asDocumentBundle(parsed);
    if (documentBundle) {
      return documentBundle.entry
        .map((bundleEntry: any) => bundleEntry?.resource as Record<string, any> | undefined)
        .filter((resource: Record<string, any> | undefined): resource is Record<string, any> => Boolean(resource?.resourceType));
    }

    if (this.getSupportedProjectedResourceType((parsed as any).resourceType)) {
      return [parsed as Record<string, any>];
    }
    return [];
  }

  private extractCompositionResourceFromCommunicationPayload(
    fhirResource: FhirCommunication,
  ): Record<string, any> | undefined {
    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];
    for (const payload of payloads) {
      const attachment = this.resolveCommunicationPayloadAttachment(payload)?.documentAttachment;
      if (!attachment || typeof attachment !== 'object') continue;
      const parsed = this.parseAttachmentJson(attachment);
      const documentBundle = this.asDocumentBundle(parsed);
      if (!documentBundle) continue;
      const composition = documentBundle.entry
        .map((bundleEntry: any) => bundleEntry?.resource as Record<string, any> | undefined)
        .find((resource: Record<string, any> | undefined) => resource?.resourceType === 'Composition');
      if (composition) return composition;
    }
    return undefined;
  }

  private asDocumentBundle(parsed: any): any | undefined {
    if (!parsed || parsed.resourceType !== 'Bundle' || !Array.isArray(parsed.entry)) return undefined;
    if (String(parsed.type || '').toLowerCase() !== 'document') return undefined;
    return parsed;
  }

  private parseDocumentBundle(jsonText: string): any | undefined {
    const parsed = JSON.parse(jsonText);
    return this.asDocumentBundle(parsed);
  }
}
