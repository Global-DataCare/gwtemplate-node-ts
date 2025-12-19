// src/__tests__/utils/sdk-helpers.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { ClaimsRecord } from '../../models/resource-document';
import { JobRequest, JobStatus } from '../../models/confidential-job';
import { ClaimsPersonSchemaorg } from '../../models/schemaorg';
import { determineResourceId } from '../../utils/resource';
import { BundleEntry } from '../../models/bundle';
import { JobAction } from '../../models/urlPath';

/**
 * **SDK Helper Part 1: Entry Creation**
 *
 * Simulates a client-side SDK function that takes raw form data (claims) and
 * formats it into a standardized BundleEntry object, including the mandatory
 * `request.url` field.
 *
 * @param claims The raw key-value pairs of claims from a form.
 * @param formType The semantic type of the form being submitted.
 * @param method The intended action for this entry. Defaults to 'PUT' for upsert.
 * @returns A fully-formed BundleEntry object.
 */
export const createEntryFromClaims = (
  claims: ClaimsRecord,
  formType: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'PUT'
): BundleEntry => {
  const resourceType = 'EmployeeRole'; // The logical resource this form represents
  const identifierClaim = claims[ClaimsPersonSchemaorg.identifier];

  if (!identifierClaim && method !== 'POST') {
    throw new Error(`Missing identifier claim for a ${method} operation`);
  }

  const resourceId = determineResourceId(identifierClaim || '');
  const url = method === 'POST' ? resourceType : `${resourceType}/${resourceId}`;

  return {
    type: formType,
    request: { method, url },
    meta: { claims },
  };
};

/**
 * **SDK Helper Part 2: Job Request Assembly**
 *
 * Simulates the final step of a client-side SDK, creating the JobRequest
 * object that a backend worker would receive from the queue.
 *
 * @param entries An array of BundleEntry objects.
 * @param issuerDid The specific DID of the actor issuing the request.
 * @param targetDid The DID of the target gateway/provider.
 * @returns A fully-formed JobRequest object.
 */
export const sdkCreateJobRequest = (
  entries: BundleEntry[],
  issuerDid: string, // TODO: backend middleware to translate external did:web to hosted did:web
  targetDid: string
): JobRequest => {
  // In a real implementation, the backend derives tenantId from the issuerDid.
  const didParts = issuerDid.split(':');
  const tenantId = didParts.length > 3 ? didParts[3] : '';

  return {
    id: uuidv4(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    action: JobAction._batch,
    tenantId,
    content: {
      jti: uuidv4(),
      thid: uuidv4(), // Use UUID for transaction IDs.
      iss: issuerDid,
      aud: targetDid,
      type: 'json',
      body: {
        type: 'batch',
        data: entries,
      },
    },
  };
};
