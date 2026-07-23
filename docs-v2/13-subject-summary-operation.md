# 13 Subject Summary Operation

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- define the target v2 summary semantics,
- keep summary retrieval separate from legacy `_search` teaching.

## Canonical Endpoint

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary`

Compatibility alias:

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$summary`

## Canonical Rules

- `Subject/$summary` is the canonical cross-sector name.
- `Patient/$summary` is a healthcare-facing alias.
- new docs must not teach legacy `_search` as the primary summary model.
- when transported through `Communication`,
  `Communication.content-reference` selects `Subject/$summary` and
  `Communication.content-attachment-data` carries the base64-encoded FHIR
  `Parameters` resource.
- the FHIR `Parameters.parameter[]` array carries `subject`, `document-type`
  and zero or more `section` filters.
- query parameters on `content-reference` remain compatibility input only.
- this is a read operation. SDKs must expose it as
  `requestClinicalSummary(...)`, never as ingestion or index update.
- a successful operation returns `Bundle-summary-response-v1.0` containing one
  FHIR `Bundle` of type `document`.

## Reader Ownership

- `gdc-common-utils-ts` `BundleReader` owns section enumeration, reference
  counts and resource-entry resolution.
- `gdc-sdk-core-ts` `FhirDocumentFacade` owns resource retrieval and combined
  section/type/date filters.
- `LifecycleResultReader` owns operation statuses/issues, not document content.
- GDC Node and Front actor facades expose the same summary result.
- UHC Node/Front extensions reuse those readers and only add product formats
  such as FHIR R5.

## Payload Source Of Truth

- shared example:
  [communication-bundle-document-request.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/examples/communication-bundle-document-request.ts)
- shared helper:
  [communication-bundle-document-request.ts utils](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/utils/communication-bundle-document-request.ts)

## Related Tests

- `gdc-common-utils-ts/__tests__/101-communication-search-reference.test.ts`
- `gdc-common-utils-ts/__tests__/utils-communication-bundle-document-request.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/managers/CompositionManager.test.ts`
- `gwtemplate-node-ts/src/__tests__/integration/composition.bundle-search.api.test.ts`

## Out Of Scope

- legacy `Bundle/_search` as first-choice summary semantics
- direct route-first teaching before communication-layer semantics
