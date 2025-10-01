// src/services/DidDocumentBuilder.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { JwkSet } from '../models/jwk';
import { DidDocument, DidService } from '../models/did';
import { PublicJWKey, RecipientPublicKey } from '../models/crypto';

export interface BuildDidDocumentParams {
  didId: string;
  didContext?: string | string[];
  publicKeysJwk: JwkSet;
  /** The internal service configuration templates. */
  configServices: DidService[];
  /** The base URL for constructing full service endpoint URLs. */
  baseUrl: string;
}

/**
 * A generic service for building public DID Documents.
 */
export class DidDocumentBuilder {
  /**
   * Constructs a public DID Document from its constituent parts,
   * including service endpoint expansion.
   */
  public build(params: BuildDidDocumentParams): DidDocument {
    const { didId, publicKeysJwk, configServices, baseUrl } = params;
    const didContext = params.didContext || 'https://www.w3.org/ns/did/v1';

    const verificationMethods: RecipientPublicKey[] = publicKeysJwk.keys.map(key => ({
      id: `${didId}#${key.kid}`,
      type: 'JsonWebKey2020',
      controller: didId,
      publicKeyJwk: key as PublicJWKey,
    }));

    const publicServices: DidService[] = configServices.flatMap(serviceTemplate => {
      const resourceTypes = (serviceTemplate.serviceEndpoint as string).split(',');
      const actions = serviceTemplate.actions || [];

      return resourceTypes.flatMap(resourceType => {
        return actions.map((action: string) => {
          const serviceIdParts = serviceTemplate.id.split('_');
          const publicServiceId = `${didId}#${serviceIdParts.join('-')}-${resourceType.toLowerCase()}-${action.replace('_', '')}`;
          const endpointUrl = `${baseUrl}/${serviceIdParts.slice(1).join('/')}/${resourceType}/${action}`;

          return {
            id: publicServiceId,
            type: serviceTemplate.type,
            serviceEndpoint: endpointUrl,
          };
        });
      });
    });

    const didDocument: DidDocument = {
      '@context': didContext,
      id: didId,
      verificationMethod: verificationMethods,
      service: publicServices,
    };

    return didDocument;
  }
}
