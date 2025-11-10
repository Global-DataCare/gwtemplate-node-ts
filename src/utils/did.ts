// src/utils/did.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { PublicJwk } from '../crypto/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from '../models/did';
import { JwkSet } from '../models/jwk';

/**
 * Encodes a hostname according to did:web spec (percent-encodes port colons).
 * @param apiUrl The full base URL of the API.
 * @returns The percent-encoded hostname.
 */
function getEncodedHost(apiUrl: string): string {
  try {
    const parsedUrl = new URL(apiUrl);
    return parsedUrl.host.replace(':', '%3A');
  } catch (e) {
    console.error(`[getEncodedHost] Invalid apiUrl provided: ${apiUrl}`);
    return 'localhost'; // Fallback
  }
}

/**
 * Composes the canonical did:web for the host service.
 * It prioritizes a public-facing domain if available.
 *
 * @param apiBaseUrl The internal base URL of the API (e.g., "http://localhost:3000").
 * @param hostExternalDomain (Optional) The public-facing domain (e.g., "host.example.com").
 * @returns The host's did:web string.
 */
export function composeHostDidWebId(apiBaseUrl: string, hostExternalDomain?: string): string {
  const authoritativeUrl = hostExternalDomain ? `https://${hostExternalDomain}` : apiBaseUrl;
  const encodedHost = getEncodedHost(authoritativeUrl);
  return `did:web:${encodedHost}`;
}

/**
 * Creates the deterministic "hosted" did:web for a tenant.
 * It correctly constructs the path portion of the DID, including the 'cds-' prefix,
 * to align with the server's URL routing structure.
 *
 * @param hostDidWeb The DID of the host (e.g., 'did:web:host.com').
 * @param tenantAlternateName The alternate name of the tenant (e.g., 'acme').
 * @param context An object containing jurisdiction, version, and sector.
 * @returns The tenant's full, correctly formatted hosted did:web.
 *          Example: 'did:web:host.com:acme:cds-us:v1:health-care'
 */
export function createHostedDidWeb(
  hostDidWeb: string,
  tenantAlternateName: string,
  context: { jurisdiction: string; version: string; sector: string }
): string {
  const hostPart = hostDidWeb.replace(/^did:web:/, '');
  // The path in a did:web uses colons as separators.
  const didPath = `cds-${context.jurisdiction}:${context.version}:${context.sector}`;
  return `did:web:${hostPart}:${tenantAlternateName}:${didPath}`;
}

export function getPrimaryDidWeb(
  didDocument: DidDocument,
  hostDidWeb: string,
  context: { jurisdiction: string; version: string; sector: string }
): string | undefined {
  if (!didDocument) return undefined;

  if (didDocument.id === hostDidWeb) {
    return hostDidWeb;
  }

  const alternateName = (didDocument as any).alternateName;
  if (!alternateName) return undefined;

  const hostedDidWeb = createHostedDidWeb(hostDidWeb, alternateName, context);

  const externalDid = didDocument.alsoKnownAs?.find(
    (alias: string) => alias.startsWith('did:web:') && alias !== hostedDidWeb,
  );
  if (externalDid) {
    return externalDid;
  }
  
  return hostedDidWeb;
}

export function findSigningMethod(didDocument: DidDocument, alg?: string): string | undefined {
  if (!didDocument || !didDocument.verificationMethod) {
    return undefined;
  }
  if (!alg) {
    return didDocument.verificationMethod[0]?.id;
  }
  const vm = didDocument.verificationMethod.find((method) => (method.publicKeyJwk as any)?.alg === alg);
  return vm?.id;
}

export function populateDidDocumentFromJwks(skeletonDidDoc: DidDocument, jwks: JwkSet): DidDocument {
    const newDidDoc: DidDocument = {
        ...skeletonDidDoc,
        verificationMethod: [],
        assertionMethod: [],
        keyAgreement: [],
    };

    const didWebs = new Set<string>();
    if (skeletonDidDoc.id.startsWith('did:web:')) {
        didWebs.add(skeletonDidDoc.id);
    }
    skeletonDidDoc.alsoKnownAs?.forEach((alias: string) => {
        if (alias.startsWith('did:web:')) {
            didWebs.add(alias);
        }
    });

    if (!jwks || !jwks.keys) {
        return newDidDoc;
    }

    for (const key of jwks.keys) {
        for (const did of Array.from(didWebs)) {
            const keyIdFragment = key.kid || `key-${(newDidDoc.verificationMethod?.length || 0) + 1}`;
            const verificationMethodId = `${did}#${keyIdFragment}`;

            const vm: VerificationMethod = {
                id: verificationMethodId,
                controller: did,
                type: 'JsonWebKey2020',
                publicKeyJwk: key as PublicJwk,
            };

            const isSignatureKey = key.use === 'sig' || (key.key_ops && key.key_ops.includes('sign'));
            const isEncryptionKey = key.use === 'enc' || (key.key_ops && key.key_ops.includes('encrypt'));
            let isAddedToVerificationMethods = false;

            if (isSignatureKey) {
                newDidDoc.verificationMethod!.push(vm);
                newDidDoc.assertionMethod!.push(vm);
                isAddedToVerificationMethods = true;
            }
            if (isEncryptionKey) {
                // A key might be for both signing and encryption. Avoid adding it twice to the main list.
                if (!isAddedToVerificationMethods) {
                    newDidDoc.verificationMethod!.push(vm);
                }
                newDidDoc.keyAgreement!.push(vm);
            }
        }
    }
    return newDidDoc;
}

export const createDidServiceId = (params: { version: string; sector: string; section: string; format: string, resourceType?: string }) => {
  const version = params.version.toLowerCase();
  const sector = params.sector.toLowerCase();
  const section = params.section.toLowerCase();
  const sanitizedFormat = params.format.toLowerCase().replace(/\./g, '-');
  let id = `${version}_${sector}_${section}_${sanitizedFormat}`;
  if (params.resourceType) {
    id += `_${params.resourceType.toLowerCase()}`;
  }
  return id;
};

/**
 * Converts a did:web identifier into a full HTTPS or HTTP base URL.
 * It correctly decodes percent-encoded ports for local development.
 * @param did The did:web string (e.g., 'did:web:example.com' or 'did:web:localhost%3A3000').
 * @returns The full base URL (e.g., 'https://example.com' or 'http://localhost:3000').
 */
export function getBaseUrlFromDidWeb(did: string): string {
  const domainPart = did.replace(/^did:web:/, '').split(':')[0];
  const decodedDomain = decodeURIComponent(domainPart);
  
  const protocol = decodedDomain.startsWith('localhost') ? 'http' : 'https';
  
  return `${protocol}://${decodedDomain}`;
}
