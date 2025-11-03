// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/CommunicationManager.ts
// Description: Manager for handling business logic related to FHIR Communications.

import { CommMsgExtended, DataEntry, FhirCommunication } from '../models/comm';
import { IPayloadResponse } from '../models/response';
import { Bundle, BundleEntryResponse, ErrorEntry } from '../models/bundle';
import { determineResourceId } from '../utils/resource';
import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { TenantsCacheManager } from './TenantsCacheManager';
import { JobRequest } from '../models/request';
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
  public async process(job: JobRequest): Promise<IPayloadResponse> {
    const bundleEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const now = Math.floor(Date.now() / 1000);

    const entries = job.content.body.data || [job.content.body];

    for (const entry of entries) {
      try {
        const fhirResource: FhirCommunication = entry.resource;
        
        if (fhirResource.resourceType !== 'Communication') {
          console.warn(`Skipping resource of type ${fhirResource.resourceType}`);
          continue;
        }

        const serverDid = this.tenantsCacheManager.getTenantDid(getTenantVaultId(job.sector as string, job.tenantId as string));
        if (!serverDid) {
            throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
        }
        const commMsg = this.convertFhirToCommMsg(job.content.thid, serverDid, fhirResource);
        
        bundleEntries.push({
          response: { status: '200' },
          id: determineResourceId(entry),
          type: 'CommMsgExtended',
          resource: commMsg,
        });

      } catch (error) {
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
          id: determineResourceId(entry),
          type: 'OperationOutcome',
          meta: entry.meta,
        });
      }
    }

    const responseBundle: Bundle<BundleEntryResponse | ErrorEntry> = {
      type: `${job.action}-response`,
      data: bundleEntries,
    };
    
    const serverDid = this.tenantsCacheManager.getTenantDid(getTenantVaultId(job.sector as string, job.tenantId as string));
    if (!serverDid) {
      // This is a critical configuration error. The tenant is not in the cache.
      // We cannot issue a response without a valid DID.
      throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
    }

    // The audience of our response should be the issuer of the request
    const aud = job.meta?.bearer?.jwt?.payload?.iss || '';

    return {
      iss: serverDid,
      aud: aud,
      exp: now + 300, // 5 minutes expiration
      thid: job.content.thid,
      body: responseBundle,
    };
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
}
