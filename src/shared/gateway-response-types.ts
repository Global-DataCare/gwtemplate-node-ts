import { BundleType } from '../utils/bundle';
import { OrganizationEmployeeSearchResponseEntryTypes } from 'gdc-common-utils-ts';

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
  EmployeeSearch: OrganizationEmployeeSearchResponseEntryTypes.Employee,
  LicenseSearch: OrganizationEmployeeSearchResponseEntryTypes.License,
  MedicationStatementSearch: 'MedicationStatement-search-response-v1.0',
  OfferSearch: 'Offer-search-response-v1.0',
  OrderSearch: 'Order-search-response-v1.0',
  ResearchSubjectSearch: 'ResearchSubject-search-response-v1.0',
  SubjectSearch: 'Subject-search-response-v1.0',
  OperationOutcome: 'OperationOutcome',
} as const);

export const GatewayEnvelopeTypes = Object.freeze({
  TransactionResponse: BundleType.TransactionResponse,
  BatchResponse: BundleType.BatchResponse,
} as const);
