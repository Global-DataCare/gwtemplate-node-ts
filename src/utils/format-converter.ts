// src/utils/format-converter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { safelyJoinUrl } from "./url";

/**
 * Normalizes a FHIR resource or Bundle into an array of entries.
 */
export const convertResourceDataToArrayOfDataEntries = (inputData: any, requestPath: string, webDomain: string): any[] => {
  if (inputData.resourceType) { // It is FHIR data
    if (inputData.resourceType === 'Bundle') {
      return inputData.entry || [];
    } else {
      const resourceIdentifier = inputData.id || (inputData.identifier && inputData.identifier[0]?.value) || "";
      const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
      return [{ fullUrl, resource: inputData }];
    }
  } else { // Assume it's already a JSON:API-like object
    const resourceIdentifier = inputData.id || "";
    // const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
    return [inputData];
  }
};

/**
 * Converts a resource or a FHIR Bundle to a JSON:API Primary Document.
 */
export const convertResourceOrBundleToPrimaryDoc = (resourceData: any, specification: string, webDomain: string, requestPath: string): any => {
  const entries = convertResourceDataToArrayOfDataEntries(resourceData, requestPath, webDomain);
  
  // Handle FHIR entry structure vs. JSON:API data structure
  const data = entries.map(entry => {
    if (entry.resource) { // It's a FHIR entry
      return {
        type: `${specification}.${entry.resource.resourceType}`,
        id: entry.resource.id,
        attributes: { ...entry.resource }
      };
    }
    return entry; // Assumes it's already a JSON:API resource object
  });

  return { data };
};

/**
 * Converts a JSON:API Primary Document back to a FHIR Bundle.
 */
export const convertPrimaryDocToBundleFHIR = (primaryDocument: any, bundleType: string): any => {
  const entries: any[] = [];
  if (primaryDocument.data) {
    entries.push(...primaryDocument.data.map((jsonApiResourceObject: any) => ({
      // fullUrl might need to be reconstructed based on context
      resource: jsonApiResourceObject.attributes || jsonApiResourceObject
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
  
  return {
    entry: entries,
    resourceType: 'Bundle',
    total: primaryDocument.data ? primaryDocument.data.length : 0,
    type: bundleType
  };
};


/**
 * Converts a FHIR Bundle containing one or more OperationOutcome entries into a
 * compliant JSON:API Error Document. Each error entry in the bundle is mapped
 * to a corresponding error object in the JSON:API `errors` array.
 *
 * @param errorBundle The FHIR Bundle representing the error(s).
 * @returns A JSON:API document with a top-level `errors` array.
 */
export const convertFhirErrorBundleToJsonApiError = (errorBundle: any): any => {
  if (!errorBundle.entry || errorBundle.entry.length === 0) {
    return {
      errors: [{
        status: '500',
        title: 'Unknown Error',
        detail: 'An unspecified error occurred and the error bundle was malformed or empty.'
      }]
    };
  }

  const errorObjects = errorBundle.entry.map((entry: any) => {
    const resource = entry.resource || {};
    const issue = resource.issue ? resource.issue[0] : {};
    const title = issue.details?.text || 'Processing Error';

    return {
      id: resource.id,
      status: entry.response?.status?.toString() || '500',
      code: issue.code || 'processing-error',
      title: title,
      detail: issue.diagnostics || 'An error occurred while processing the request.',
      meta: {
        severity: issue.severity || 'error'
      }
    };
  });

  return {
    errors: errorObjects
  };
};