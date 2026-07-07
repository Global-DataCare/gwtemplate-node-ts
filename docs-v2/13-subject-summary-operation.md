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
- when transported through `Communication`, the canonical semantics still live in `resource.meta.claims`.

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

## Out Of Scope

- legacy `Bundle/_search` as first-choice summary semantics
- direct route-first teaching before communication-layer semantics
