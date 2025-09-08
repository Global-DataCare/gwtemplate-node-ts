// src/utils/bundle.ts

/* Copyright (c) Connecting Solution & Applications Ltd. */
/* Apache License 2.0 */

import { safelyJoinUrl } from "./url";

/**
* Converts a resource (FHIR Bundle or single resource) or a JSON:API object
* to a canonical array of entries. This is the primary normalization function.
* @param inputData The raw input body.
* @param requestPath The path from the original request URL.
* @param webDomain The domain of the service.
* @returns A canonical array of data entries.
*/
export const convertResourceDataToArrayOfDataEntries = (inputData: any, requestPath: string, webDomain: string): any[] => {
  if (!inputData) return [];

  if (inputData.resourceType) { // FHIR data
    if (inputData.resourceType === 'Bundle') {
      return inputData.entry || []; // Return the array of "entries"
    } else {
      // It's a single FHIR resource
      const resourceIdentifier = inputData.id || "";
      const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
      return [{ fullUrl: fullUrl, resource: inputData }];
    }
  } else if (inputData.data) { // JSON:API Primary Document
    return inputData.data;
  } else {
    // Assume it's a single JSON:API Resource Object
    const resourceIdentifier = inputData.id || "";
    const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
    return [{ ...inputData }];
  }
};

/**
* Converts a resource or a bundle into a JSON:API Primary Document structure.
* @param resourceData The source data.
* @param webDomain The domain of the service.
* @param requestPath The path from the request.
* @returns A JSON:API Primary Document.
*/
export const convertResourceOrBundleToPrimaryDoc = (resourceData: any, webDomain: string, requestPath: string): any => {
  const entries = convertResourceDataToArrayOfDataEntries(resourceData, requestPath, webDomain);
  return {
    data: entries.map(entry => ({
      // This mapping can be made more sophisticated if needed
      ...entry,
    })),
  };
};

/**
* Converts a JSON:API Primary Document back to a FHIR Bundle.
* @param primaryDocument The JSON:API document.
* @param bundleType The desired type of the output bundle (e.g., 'batch-response').
* @returns A FHIR Bundle.
*/
export const convertPrimaryDocToBundleFHIR = (primaryDocument: any, bundleType: string): any => {
  const entries: any[] = [];

  if (primaryDocument.data) {
    entries.push(...primaryDocument.data.map((jsonApiResourceObject: any) => ({
      fullUrl: jsonApiResourceObject.fullUrl,
      resource: jsonApiResourceObject.resource
    })));
  }

  if (primaryDocument.errors) {
    entries.push(...primaryDocument.errors.map((errorObject: any) => ({
      resource: {
        resourceType: 'OperationOutcome',
        id: errorObject.id,
        issue: [{
          code: errorObject.status,
          severity: 'error',
          details: { text: errorObject.detail },
        }]
      }
    })));
  }

  const bundle: any = {
    entry: entries,
    resourceType: 'Bundle',
    total: primaryDocument.data ? primaryDocument.data.length : 0,
    type: bundleType
  };

  if (primaryDocument.id) {
    bundle.identifier = [{ value: primaryDocument.id }];
  }

  return bundle;
};

// --- Bundle & ManagerResult Creation/Mutation Utilities ---

import { Bundle, BundleEntry } from '@/models/bundle';
import { ManagerResult } from '@/models/manager-result';

/**
 * Appends a new entry to a ManagerResult object, preserving order.
 * This is a pure function; it returns a new ManagerResult object.
 * @param result The existing ManagerResult.
 * @param newEntry The success or error entry to add.
 * @returns A new ManagerResult with the added entry.
 */
export function addEntryToResult(result: ManagerResult, newEntry: BundleEntry): ManagerResult {
  return {
    entries: [...result.entries, newEntry],
  };
}

/**
 * Creates a final response Bundle from the aggregated results of a manager.
 * This is used by the Worker after the Manager has successfully processed all entries.
 * @param managerResult The result object from the business logic manager.
 * @returns A final response Bundle.
 */
export function createSuccessBundle(managerResult: ManagerResult): Bundle {
  return {
    type: 'batch-response',
    data: managerResult.entries, // Simply use the ordered list of entries
  };
}

/**
 * Creates a response Bundle containing a single, fatal error entry.
 * This is used by the Worker when a catastrophic error occurs before the
 * manager can even process the job.
 * @param errorMessage The high-level error message to report.
 * @returns A response Bundle containing a single error entry.
 */
export function createErrorBundle(errorMessage: string): Bundle {
  const errorEntry: BundleEntry = {
    resource: {}, // Empty resource for a fatal error
    response: {
      status: '500',
      outcome: {
        issue: [{
          severity: 'error',
          code: 'exception',
          details: { text: errorMessage },
        }]
      }
    }
  };

  return {
    type: 'batch-response',
    data: [errorEntry]
  };
}

