// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/CommunicationManager.ts
// Description: Manager for handling business logic related to FHIR Communications.

import { CommMsgExtended, DataEntry, FhirCommunication } from 'gdc-common-utils-ts/models/comm';
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
import { fhirResourceToCid } from '../utils/fhir-versioning';

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
        await this.persistCompositionProjectionFromCommunication(job, entry as any, fhirResource, serverDid);
        await this.persistDocumentReferenceProjectionFromCommunication(job, entry as any, fhirResource);

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
    const sectionCode = claimsSection || payloadSection || 'LOINC|60591-5';

    const sent = String(
      (entry?.meta?.claims?.['Communication.sent'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Communication.sent'] as string | undefined)
      || fhirResource?.sent
      || new Date().toISOString(),
    );

    const recordId = `composition-from-communication-${determineResourceId(String(job.content?.thid || ''), process.env.NODE_ENV)}`;
    const claims = {
      '@context': 'org.hl7.fhir.r4',
      'Composition.identifier': recordId,
      'Composition.subject': subject,
      'Composition.section': sectionCode,
      'Composition.author': serverDid,
      'Composition.date': sent,
      'Composition.type': sectionCode,
      'Composition.source': 'Communication',
    };
    const sectionId = getSubjectScopedSectionId(subject, 'individual', 'composition');
    await this.vaultRepository.put(tenantVaultId, [{ id: recordId, ...claims } as any], sectionId);
  }

  private extractCompositionSectionFromCommunicationPayload(fhirResource: FhirCommunication): string | undefined {
    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const fromCodeableConcept = payload?.contentCodeableConcept?.coding?.[0];
    if (fromCodeableConcept?.system && fromCodeableConcept?.code) {
      return `${fromCodeableConcept.system}|${fromCodeableConcept.code}`;
    }

    const contentType = String(payload?.contentAttachment?.contentType || '').toLowerCase();
    const encodedData = String(payload?.contentAttachment?.data || '').trim();
    if (!encodedData || !contentType.includes('json')) return undefined;

    try {
      const decoded = Buffer.from(encodedData, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      if (parsed?.resourceType !== 'Bundle' || !Array.isArray(parsed?.entry)) return undefined;
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

    const subject = String(
      (entry?.meta?.claims?.['Communication.subject'] as string | undefined)
      || (entry?.resource?.meta?.claims?.['Communication.subject'] as string | undefined)
      || (fhirResource?.subject as any)?.reference
      || '',
    ).trim();
    if (!subject) return;

    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];
    const nowIso = new Date().toISOString();
    for (const payload of payloads) {
      const attachment = payload?.contentAttachment;
      if (!attachment || typeof attachment !== 'object') continue;

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
      const documentIdentifier = `urn:uuid:${uuidv4()}`;
      const claims: Record<string, string> = {
        '@context': 'org.hl7.fhir.r4',
        'DocumentReference.identifier': documentIdentifier,
        'DocumentReference.contenthash': cid,
        'DocumentReference.subject': subject,
        'DocumentReference.contenttype': contentType,
        'DocumentReference.date': String(
          (entry?.meta?.claims?.['Communication.sent'] as string | undefined)
          || (fhirResource as any)?.sent
          || nowIso,
        ),
      };
      if (url) claims['DocumentReference.location'] = url;
      if (typeof attachment.title === 'string' && attachment.title.trim()) {
        claims['DocumentReference.description'] = attachment.title.trim();
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

  /**
   * Converts a FHIR R4 Communication resource into a CommMsgExtended object.
   * (The rest of the method remains the same)
   */
   // ... [rest of the convertFhirToCommMsg method] ...
   public convertFhirToCommMsg(thid: string, fromDid: string, fhirResource: FhirCommunication): CommMsgExtended {
    const bodyData: DataEntry[] = [];

    // Process `note` into `Annotation` objects
    if (fhirResource.note) {
      fhirResource.note.forEach((note) => {
        if (!note?.text) return;
        bodyData.push({
          type: 'Annotation',
          id: uuidv4(),
          resource: { text: note.text },
        });
      });
    }

    // Process `payload` into `Reference` and `Attachment` objects
    if (fhirResource.payload) {
      fhirResource.payload.forEach((pld) => {
        if (pld.contentReference?.reference) {
          bodyData.push({
            type: 'Reference',
            id: uuidv4(),
            resource: {
              reference: pld.contentReference.reference,
              type: 'Appointment', // This could be made dynamic if needed
            },
          });
        } else if (pld.contentAttachment?.contentType || pld.contentAttachment?.data || pld.contentAttachment?.title) {
          bodyData.push({
            type: 'Attachment',
            id: uuidv4(),
            resource: {
              contentType: pld.contentAttachment.contentType,
              data: pld.contentAttachment.data,
              title: pld.contentAttachment.title,
            },
          });
        }
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
}
