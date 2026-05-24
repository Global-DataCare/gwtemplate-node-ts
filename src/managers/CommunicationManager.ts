// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/CommunicationManager.ts
// Description: Manager for handling business logic related to FHIR Communications.

import { CommMsgExtended, DataEntry, FhirCommunication } from 'gdc-common-utils-ts/models/comm';
import { HealthcareBasicSections } from '../shared/healthcare-constants';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { determineResourceId } from '../utils/resource';
import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { TenantsCacheManager } from './TenantsCacheManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { createHash } from 'crypto';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { applyFhirCidVersioningToEntry, fhirResourceToCid } from '../utils/fhir-versioning';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { persistConsentRuleAndAttachment } from '../utils/consent-storage';

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
  section: string;
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
    section: 'medications',
    subjectClaimKeys: ['MedicationStatement.subject', 'MedicationStatement.patient'],
    identifierClaimKeys: ['MedicationStatement.identifier', 'MedicationStatement.identifier.value'],
  },
  Observation: {
    section: 'observations',
    subjectClaimKeys: ['Observation.subject', 'Observation.patient'],
    identifierClaimKeys: ['Observation.identifier', 'Observation.identifier.value'],
  },
  AllergyIntolerance: {
    section: 'allergies',
    subjectClaimKeys: ['AllergyIntolerance.patient', 'AllergyIntolerance.subject'],
    identifierClaimKeys: ['AllergyIntolerance.identifier', 'AllergyIntolerance.identifier.value'],
  },
  Condition: {
    section: 'conditions',
    subjectClaimKeys: ['Condition.subject', 'Condition.patient'],
    identifierClaimKeys: ['Condition.identifier', 'Condition.identifier.value'],
  },
  Procedure: {
    section: 'procedures',
    subjectClaimKeys: ['Procedure.subject', 'Procedure.patient'],
    identifierClaimKeys: ['Procedure.identifier', 'Procedure.identifier.value'],
  },
  ImagingStudy: {
    section: 'imaging-studies',
    subjectClaimKeys: ['ImagingStudy.subject', 'ImagingStudy.patient'],
    identifierClaimKeys: ['ImagingStudy.identifier', 'ImagingStudy.identifier.value'],
  },
  Immunization: {
    section: 'immunizations',
    subjectClaimKeys: ['Immunization.patient', 'Immunization.subject'],
    identifierClaimKeys: ['Immunization.identifier', 'Immunization.identifier.value'],
  },
  RelatedPerson: {
    section: 'related-persons',
    subjectClaimKeys: ['RelatedPerson.patient', 'RelatedPerson.subject'],
    identifierClaimKeys: ['RelatedPerson.identifier', 'RelatedPerson.identifier.value'],
  },
  DiagnosticReport: {
    section: 'diagnostic-reports',
    subjectClaimKeys: ['DiagnosticReport.subject', 'DiagnosticReport.patient'],
    identifierClaimKeys: ['DiagnosticReport.identifier', 'DiagnosticReport.identifier.value'],
  },
  CarePlan: {
    section: 'care-plans',
    subjectClaimKeys: ['CarePlan.subject', 'CarePlan.patient'],
    identifierClaimKeys: ['CarePlan.identifier', 'CarePlan.identifier.value'],
  },
  Encounter: {
    section: 'encounters',
    subjectClaimKeys: ['Encounter.subject', 'Encounter.patient'],
    identifierClaimKeys: ['Encounter.identifier', 'Encounter.identifier.value'],
  },
  AdverseEvent: {
    section: 'adverse-events',
    subjectClaimKeys: ['AdverseEvent.subject', 'AdverseEvent.patient'],
    identifierClaimKeys: ['AdverseEvent.identifier', 'AdverseEvent.identifier.value'],
  },
  Consent: {
    section: 'consents',
    subjectClaimKeys: ['Consent.subject', 'Consent.patient'],
    identifierClaimKeys: ['Consent.identifier', 'Consent.identifier.value'],
  },
};

interface CommunicationManagerOptions {
  tenantsCacheManager: TenantsCacheManager;
  vaultRepository: IVaultRepository;
}

/**
 * Manages the business logic for converting FHIR Communication resources
 * into the internal CommMsgExtended format.
 */
export class CommunicationManager implements IJobProcessor {
  private readonly tenantsCacheManager: TenantsCacheManager;
  private readonly vaultRepository: IVaultRepository;

  constructor({ tenantsCacheManager, vaultRepository }: CommunicationManagerOptions) {
    this.tenantsCacheManager = tenantsCacheManager;
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes a job request containing FHIR Communication resources.
   * It iterates through the input entries, converts them, and prepares them for storage/delivery.
   * @param job The job to process.
   * @returns A promise that resolves to a payload response containing the converted messages.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
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
        
        if (fhirResource.resourceType !== 'Communication') {
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

        const identifierClaim =
          (entry as any)?.meta?.claims?.['Communication.identifier'] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        
        bundleEntries.push({
          response: { status: '200' },
          id: resourceId,
          type: 'CommMsgExtended',
          resource: commMsg,
        });

      } catch (error) {
        const identifierClaim =
          (entry as any)?.meta?.claims?.['Communication.identifier'] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        bundleEntries.push({
          response: {
            status: '500',
            outcome: {
              resourceType: 'OperationOutcome',
              issue: [{
                severity: 'error',
                code: 'processing',
                details: { text: error instanceof Error ? error.message : 'Unknown error during conversion.' },
              }],
            }
          },
          id: resourceId,
          type: 'OperationOutcome',
          meta: entry.meta,
        });
      }
    }

    const responseBundle: BundleJsonApi<BundleEntryResponse | ErrorEntry> = {
      resourceType: 'Bundle',
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

  private async persistCompositionProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    serverDid: string,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
    if (!tenantExists) return;

    const rawSubject =
      (entry?.meta?.claims?.['Communication.subject'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Communication.subject'] as string | undefined)
      || (fhirResource?.subject as any)?.reference
      || '';
    const subject = String(rawSubject || '').replace(/^Patient\//i, '').trim();
    if (!subject) return;

    const claimsSection = String(
      (entry?.meta?.claims?.['Composition.section'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Composition.section'] as string | undefined)
      || '',
    ).trim();
    const payloadSection = this.extractCompositionSectionFromCommunicationPayload(fhirResource);
    const sectionCode = claimsSection || payloadSection || HealthcareBasicSections.PatientSummaryDocument.claim;

    const sent = String(
      (entry?.meta?.claims?.['Communication.sent'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Communication.sent'] as string | undefined)
      || fhirResource?.sent
      || new Date().toISOString(),
    );

    const recordId = `composition-from-communication-${determineResourceId(String(job.content?.thid || ''), process.env.NODE_ENV)}`;
    const claims = normalizeContextualizedClaims({
      '@context': 'org.hl7.fhir.r4',
      'Composition.identifier': recordId,
      'Composition.subject': subject,
      'Composition.section': sectionCode,
      'Composition.author': serverDid,
      'Composition.date': sent,
      'Composition.type': sectionCode,
      'Composition.source': 'Communication',
    });
    const sectionId = getSubjectScopedSectionId(subject, 'individual', 'composition');
    await this.vaultRepository.put(tenantVaultId, [{ id: recordId, ...claims } as any], sectionId);
  }

  private async persistCommunicationChannelRecord(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    commMsg: CommMsgExtended,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
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
      type: 'CommMsgExtended',
      thid: threadId,
      pthid: String(job.content?.pthid || commMsg.pthid || '').trim() || undefined,
      from: commMsg.from,
      to: commMsg.to,
      created_time: commMsg.created_time,
      audit: {
        created: sent,
        updated: sent,
        channel: 'communication',
      },
      resource: commMsg,
      'Communication.identifier': this.resolveCommunicationIdentifier(entry, fhirResource),
      'Communication.subject': subject,
      'Communication.recipient': this.resolveCommunicationRecipient(entry, fhirResource),
      'Communication.sender': this.resolveCommunicationSender(entry, fhirResource),
      'Communication.sent': sent,
      'Communication.note-text': noteText || undefined,
      meta: {
        payloadCount: payloads.length,
        documentReferenceCount: attachmentCount,
      },
    };
    if (contentReferences.length > 0) {
      record['Communication.content-reference'] = contentReferences.join(',');
    }

    const sectionId = getSubjectScopedSectionId(subject, 'individual', 'communications');
    await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
  }

  private extractCompositionSectionFromCommunicationPayload(fhirResource: FhirCommunication): string | undefined {
    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const fromCodeableConcept = payload?.contentCodeableConcept?.coding?.[0];
    if (fromCodeableConcept?.system && fromCodeableConcept?.code) {
      return `${fromCodeableConcept.system}|${fromCodeableConcept.code}`;
    }

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
        return `${coding.system}|${coding.code}`;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  private async persistDocumentReferenceProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
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

      const recordId = `documentreference-from-communication-${determineResourceId(String(cid), process.env.NODE_ENV)}`;
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

      const sectionId = getSubjectScopedSectionId(subject, 'individual', 'document-references');
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

  private async persistProjectedResourcesFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
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
        applyFhirCidVersioningToEntry({
          entry: { resource },
          claims,
          resourceType,
          resourceId: fallbackId,
        });

        const recordId = String(resource?.id || fallbackId);
        const sectionId = getSubjectScopedSectionId(subjectRef, 'individual', config.section);
        const record: Record<string, any> = {
          id: recordId,
          ...claims,
          indexed: { attributes: this.buildIndexedAttributesFromClaims(claims) },
        };
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        if (resourceType === 'Consent') {
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

    const subjectRef = String(
      resource?.subject?.reference
      || resource?.patient?.reference
      || communicationSubject
      || '',
    ).replace(/^Patient\//i, '').trim();
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
    const codeSystem = String(codeCoding?.system || '').trim();
    const codeValue = String(codeCoding?.code || '').trim();
    if (codeValue) {
      baseClaims[`${resourceType}.code`] = codeSystem ? `${codeSystem}|${codeValue}` : codeValue;
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
      const userSelectedRaw = resource?.medicationCodeableConcept?.coding?.[0]?.userSelected;
      baseClaims['MedicationStatement.user-selected'] = String(
        typeof userSelectedRaw === 'boolean' ? userSelectedRaw : true,
      );
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
      claims['Communication.note-text'] = noteText;
      claims['Communication.text'] = noteText;
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
              'Communication.note-text': noteText,
              'Communication.text': noteText,
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

    const sent = claims['Communication.sent'];
    const subject = claims['Communication.subject'];
    const recipient = claims['Communication.recipient'];
    const sender = claims['Communication.sender'];
    const text = claims['Communication.text'];

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
      entry?.meta?.claims?.['Communication.identifier']
      || entry?.resource?.meta?.claims?.['Communication.identifier']
      || resourceIdentifier
      || (fhirResource as any)?.id,
    );
  }

  private resolveCommunicationSubject(entry: any, fhirResource: FhirCommunication): string | undefined {
    const raw = this.normalizeOptionalString(
      entry?.meta?.claims?.['Communication.subject']
      || entry?.resource?.meta?.claims?.['Communication.subject']
      || (fhirResource?.subject as any)?.reference,
    );
    return raw?.replace(/^Patient\//i, '').trim();
  }

  private resolveCommunicationRecipient(entry: any, fhirResource: FhirCommunication): string | undefined {
    const claimValue = entry?.meta?.claims?.['Communication.recipient'] || entry?.resource?.meta?.claims?.['Communication.recipient'];
    if (typeof claimValue === 'string' && claimValue.trim()) return claimValue.trim();
    const recipients = Array.isArray(fhirResource?.recipient)
      ? fhirResource.recipient.map((recipient) => String(recipient?.reference || '').trim()).filter(Boolean)
      : [];
    return recipients.length > 0 ? recipients.join(',') : undefined;
  }

  private resolveCommunicationSender(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.meta?.claims?.['Communication.sender']
      || entry?.resource?.meta?.claims?.['Communication.sender']
      || (fhirResource?.sender as any)?.reference,
    );
  }

  private resolveCommunicationSent(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.meta?.claims?.['Communication.sent']
      || entry?.resource?.meta?.claims?.['Communication.sent']
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
