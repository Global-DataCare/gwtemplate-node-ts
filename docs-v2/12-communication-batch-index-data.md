# 12 Communication Batch Index Data

Purpose:

- define the canonical v2 exchange model for individual index data,
- keep the mental model claims-first and `Communication`-centric.

## Canonical Endpoint

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Communication/_batch`
- poll:
  `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Communication/_batch-response`

## Canonical Rules

- `Communication` is the auditable exchange envelope for individual index data.
- the canonical business contract lives in `resource.meta.claims`.
- `Communication.contentdata` is the canonical claim for embedded payload data.
- one batch may carry one or more `Communication` entries.
- if versioned FHIR is submitted, backend extraction/normalization derives the canonical stored claims.

## What Belongs Here

- consent-related index data
- document and composition updates
- related-person relationship data
- communication-bound summary requests
- related notifications bound to indexed data

## Payload Source Of Truth

- GW shared fixture:
  [COMMUNICATION_CREATION_MESSAGE in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared communication layering:
  [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- shared SDK consent communication guide:
  [gdc-sdk-core-ts/docs/101-CONSENT_COMMUNICATION.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-CONSENT_COMMUNICATION.md)
- shared SDK IPS outbox guide:
  [gdc-sdk-core-ts/docs/101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- related-person v2 note:
  [15-related-person-index-data.md](./15-related-person-index-data.md)

## Related Tests

- `gwtemplate-node-ts/src/__tests__/integration/consent.communication.api.test.ts`
- `gwtemplate-node-ts/src/__tests__/integration/medication-statement.api.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/managers/CommunicationManager.unit.test.ts`

## Out Of Scope

- direct `Composition/_batch` as a first teaching model
- direct `Bundle/_batch` as a first teaching model
- legacy `_search` as the primary summary model
