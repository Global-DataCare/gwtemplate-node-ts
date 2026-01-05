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

interface CommunicationManagerOptions {
  tenantsCacheManager: TenantsCacheManager;
}

/**
 * Manages the business logic for converting FHIR Communication resources
 * into the internal CommMsgExtended format.
 */
export class CommunicationManager implements IJobProcessor {
  private readonly tenantsCacheManager: TenantsCacheManager;

  constructor({ tenantsCacheManager }: CommunicationManagerOptions) {
    this.tenantsCacheManager = tenantsCacheManager;
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

    const entries = job.content.body.data || [job.content.body];

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

  /**
   * Converts a FHIR R4 Communication resource into a CommMsgExtended object.
   * (The rest of the method remains the same)
   */
   // ... [rest of the convertFhirToCommMsg method] ...
   public convertFhirToCommMsg(thid: string, fromDid: string, fhirResource: FhirCommunication): CommMsgExtended {
    const bodyData: DataEntry[] = [];

    // Process `note` into `Annotation` objects
    if (fhirResource.note) {
      fhirResource.note.forEach((note: { text: string }) => {
        bodyData.push({
          type: 'Annotation',
          id: uuidv4(),
          resource: { text: note.text },
        });
      });
    }

    // Process `payload` into `Reference` and `Attachment` objects
    if (fhirResource.payload) {
      fhirResource.payload.forEach((pld: { contentReference?: { reference: string }; contentAttachment?: { contentType: string; data: string; title:string; } }) => {
        if (pld.contentReference) {
          bodyData.push({
            type: 'Reference',
            id: uuidv4(),
            resource: {
              reference: pld.contentReference.reference,
              type: 'Appointment', // This could be made dynamic if needed
            },
          });
        } else if (pld.contentAttachment) {
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
      to: fhirResource.recipient?.map((ref: { reference: string }) => ref.reference),
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
