export { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

/**
 * Transitional GW-local FHIR resource constants that are still missing from
 * `gdc-common-utils-ts/constants/fhir-resource-types`.
 *
 * Keep this file as the only local fallback layer so the remaining values can
 * be upstreamed cleanly later.
 */
export const GatewayLocalFhirResourceTypes = Object.freeze({
  OperationOutcome: 'OperationOutcome',
  Parameters: 'Parameters',
} as const);
