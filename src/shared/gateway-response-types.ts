import { BundleType } from '../utils/bundle';

/**
 * Gateway-specific async envelope and entry `type` values.
 *
 * These are not canonical FHIR `resourceType` names, so they cannot come from
 * the shared FHIR catalog in common utils. Keep them centralized here to avoid
 * string duplication across managers, tests, docs and OpenAPI comments.
 */
export const GatewayResponseEntryTypes = Object.freeze({
  BundleSearch: 'Bundle-search-response-v1.0',
  BundleSummary: 'Bundle-summary-response-v1.0',
  CommunicationSearch: 'Communication-search-response-v1.0',
  CompositionSearch: 'Composition-search-response-v1.0',
  DocumentReferenceSearch: 'DocumentReference-search-response-v1.0',
  OperationOutcome: 'OperationOutcome',
} as const);

export const GatewayEnvelopeTypes = Object.freeze({
  TransactionResponse: BundleType.TransactionResponse,
  BatchResponse: BundleType.BatchResponse,
} as const);
