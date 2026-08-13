// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

export type GovernedFhirArtifactType =
  | 'CapabilityStatement'
  | 'CodeSystem'
  | 'ImplementationGuide'
  | 'SearchParameter';

export type GovernedCapabilityStatementOptions = Readonly<{
  canonicalBaseUrl: string;
  implementationVersion: string;
  implementationUrl: string;
  implementationDescription: string;
  enableContractSearchParameters: boolean;
}>;

type GovernedSearchParameter = Readonly<{
  id: string;
  name: string;
  type: 'date' | 'reference' | 'string' | 'token' | 'uri';
  documentation: string;
}>;

const COMMUNICATION_SEARCH_PARAMETERS: readonly GovernedSearchParameter[] = Object.freeze([
  {
    id: 'communication-actor',
    name: 'actor',
    type: 'token',
    documentation: 'Matches a normalized DID, email or telephone participant across the communication.',
  },
  {
    id: 'communication-user',
    name: 'user',
    type: 'token',
    documentation: 'Matches the organization user represented in the communication participant index.',
  },
  {
    id: 'communication-target',
    name: 'target',
    type: 'token',
    documentation: 'Matches the business target represented in the communication participant index.',
  },
  {
    id: 'communication-period-start',
    name: 'period-start',
    type: 'date',
    documentation: 'Inclusive lower bound for Communication.sent.',
  },
  {
    id: 'communication-period-end',
    name: 'period-end',
    type: 'date',
    documentation: 'Inclusive upper bound for Communication.sent.',
  },
]);

const CONTRACT_SEARCH_PARAMETERS: readonly GovernedSearchParameter[] = Object.freeze([
  {
    id: 'contract-type',
    name: 'type',
    type: 'token',
    documentation: 'High-level legal instrument category from Contract.type.',
  },
  {
    id: 'contract-provider-organization',
    name: 'provider-organization',
    type: 'reference',
    documentation: 'Organization offering or providing the governed contract capability.',
  },
  {
    id: 'contract-consumer-organization',
    name: 'consumer-organization',
    type: 'reference',
    documentation: 'Organization consuming the governed contract capability.',
  },
]);

/**
 * Builds a stable FHIR canonical URL controlled by the configured governance
 * authority. The URL is version-independent; FHIR resource `version` and the
 * immutable Git tag identify a concrete release.
 */
export function buildGovernedFhirArtifactUrl(
  canonicalBaseUrl: string,
  resourceType: GovernedFhirArtifactType,
  id: string,
): string {
  const base = String(canonicalBaseUrl || '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('FHIR canonical authority must be an absolute HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('FHIR canonical authority must use HTTPS.');
  }
  const normalizedId = String(id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/.test(normalizedId)) {
    throw new Error('FHIR canonical artifact id is invalid.');
  }
  return `${base}/${resourceType}/${normalizedId}`;
}

function declareSearchParameters(
  canonicalBaseUrl: string,
  definitions: readonly GovernedSearchParameter[],
): object[] {
  return definitions.map((definition) => ({
    name: definition.name,
    definition: buildGovernedFhirArtifactUrl(
      canonicalBaseUrl,
      'SearchParameter',
      definition.id,
    ),
    type: definition.type,
    documentation: definition.documentation,
  }));
}

/**
 * Builds the governed portion of the GW FHIR CapabilityStatement.
 *
 * Contract parameters are deliberately feature-gated so publishing a future
 * SearchParameter definition never becomes a false runtime support claim.
 */
export function buildGovernedCapabilityStatement(
  options: GovernedCapabilityStatementOptions,
): object {
  const { canonicalBaseUrl, implementationVersion } = options;
  let implementationUrl: URL;
  try {
    implementationUrl = new URL(options.implementationUrl);
  } catch {
    throw new Error('FHIR implementation URL must be an absolute HTTPS URL.');
  }
  if (implementationUrl.protocol !== 'https:') {
    throw new Error('FHIR implementation URL must use HTTPS.');
  }
  const implementationDescription = String(options.implementationDescription || '').trim();
  if (!implementationDescription) {
    throw new Error('FHIR implementation description is required.');
  }
  const resources: object[] = [{
    type: 'Communication',
    searchParam: declareSearchParameters(canonicalBaseUrl, COMMUNICATION_SEARCH_PARAMETERS),
  }];
  if (options.enableContractSearchParameters) {
    resources.push({
      type: 'Contract',
      searchParam: declareSearchParameters(canonicalBaseUrl, CONTRACT_SEARCH_PARAMETERS),
    });
  }

  return {
    resourceType: 'CapabilityStatement',
    id: 'metadata',
    version: implementationVersion,
    name: 'TenantFhirCapabilityStatement',
    title: 'Tenant FHIR endpoint capabilities',
    status: 'active',
    experimental: false,
    kind: 'instance',
    instantiates: [
      `${buildGovernedFhirArtifactUrl(canonicalBaseUrl, 'CapabilityStatement', 'gw-core')}|${implementationVersion}`,
    ],
    implementation: {
      description: implementationDescription,
      url: implementationUrl.toString().replace(/\/$/, ''),
    },
    fhirVersion: '5.0.0',
    format: ['application/fhir+json'],
    implementationGuide: [
      buildGovernedFhirArtifactUrl(canonicalBaseUrl, 'ImplementationGuide', 'network-governance'),
    ],
    rest: [{
      mode: 'server',
      resource: resources,
    }],
  };
}
