// src/utils/did-document.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidDocument } from '../models/did';
import { createDidServiceId } from './did';

// TODO: DidService type or interface

/**
 * Defines the parameters needed to create a default DID Document.
 */
interface CreateDidDocumentParams {
  alternateName: string;
  apiHostname: string;
  sector: 'system' | string;
}

/**
 * Creates a default DID Document for a new entity (host or tenant).
 * This ensures that all entities are created with a baseline set of essential services,
 * such as discovery and registry endpoints.
 *
 * @param params The parameters required to build the document.
 * @returns A complete DidDocument object.
 */
export function createDefaultDidDocument(params: CreateDidDocumentParams): DidDocument {
  const { alternateName, apiHostname, sector } = params;
  const baseUrl = alternateName === 'host' ? `https://${apiHostname}` : `https://${apiHostname}/${alternateName}`;

  // Define the list of services every new entity should have by default.
  const defaultServices: any[] = [
    {
      // The primary discovery endpoint for the DID document itself.
      id: '#did-document',
      type: 'LinkedDomains',
      serviceEndpoint: `${baseUrl}/.well-known/did.json`,
    },
    {
      // The endpoint for retrieving the entity's public keys.
      id: '#jwks',
      type: 'JsonWebKeyService2020',
      serviceEndpoint: `${baseUrl}/jwks.json`,
    },
    {
      // The default API service for registering Organizations (e.g., employees).
      // The ID is constructed programmatically to match API routing rules.
      id: createDidServiceId({ version: 'v1', sector, section: 'registry', format: 'org.schema' }),
      type: 'GatewayRegistryService',
      serviceEndpoint: 'Organization',
      actions: ['_batch'],
    },
  ];

  return {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: `did:web:${apiHostname}${alternateName === 'host' ? '' : `:${alternateName}`}`,
    service: defaultServices,
  };
}
