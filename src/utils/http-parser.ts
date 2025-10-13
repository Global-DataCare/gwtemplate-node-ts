// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/http-parser.ts

import { URL } from 'url';
import { DataInRequest } from '../models/request'; // Import from the new central model file

// --- Helper Functions ---

export function convertUrlEncodedDataToJson(formEncodedData: string): { [key: string]: string; } {
  // ... (Your implementation is solid, no changes needed)
  const extractedData: { [key: string]: string } = {};
  if (!formEncodedData) return extractedData;
  const queryString = formEncodedData.startsWith('http') ? new URL(formEncodedData).search.slice(1).trim() : formEncodedData.trim();
  queryString.replace(/(\r\n|\n|\r)/gm, '').split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key !== undefined && value !== undefined) {
        const decodedKey = decodeURIComponent(key.replace(/\+/g, ' '));
        const decodedValue = decodeURIComponent(value.replace(/\+/g, ' '));
        extractedData[decodedKey] = decodedValue;
    }
  });
  return extractedData;
}

export function convertPlainMessageToJson(message: any, contentType: string): any {
  try {
    if (contentType.includes('json')) {
      return JSON.parse(message);
    } else if (contentType.includes('x-www-form-urlencoded')) {
      return convertUrlEncodedDataToJson(message);
    } else {
      // In a real scenario, you might support XML, etc.
      return message; // Return as is if not a known type to parse
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    throw new Error(`Error processing the message: ${errorMessage}`);
  }
}


// --- Main Parsing Logic (Adapted for the new URL structure) ---

/**
 * Extracts and structures HTTP request data based on the defined CDS path structure.
 * URL Structure: /:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action
 */
export function extractHttpRequestDataAsJson(
  url: string,
  input: any,
  contentType: string,
  httpMethod: string
): DataInRequest {
  const urlObj = new URL(url, 'http://localhost'); // Base is required for parsing
  const pathParts = urlObj.pathname.split('/').filter(part => part);

  if (pathParts.length < 8) {
    throw new Error('Invalid CDS URL structure. Not enough path segments.');
  }
  
  const cdsIndex = pathParts.findIndex(part => part.startsWith('cds-'));
  if (cdsIndex === -1 || cdsIndex === 0) {
    throw new Error("Invalid CDS URL structure: 'cds-' part missing or misplaced.");
  }
  
  const actionPart = pathParts[cdsIndex + 6];
  if (!actionPart || !actionPart.startsWith('_')) {
    throw new Error('Invalid action format. Must start with an underscore (_).');
  }

  const requestData: DataInRequest = {
    requestUrl: url,
    httpMethod: httpMethod.toUpperCase(),
    input: input,
    contentType: contentType,
    tenantId: pathParts[cdsIndex - 1],
    jurisdiction: pathParts[cdsIndex].substring(4), // Remove 'cds-'
    apiVersion: pathParts[cdsIndex + 1],
    sector: pathParts[cdsIndex + 2],
    section: pathParts[cdsIndex + 3],
    format: pathParts[cdsIndex + 4],
    resourceType: pathParts[cdsIndex + 5],
    action: actionPart.substring(1), // Remove '_'
  };

  return requestData;
}
