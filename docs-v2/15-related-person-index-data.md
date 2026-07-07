# 15 Related Person Index Data

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- model caregiver/family relationship data as individual index data,
- keep the v2 teaching model `Communication`-centric and claims-first.

## Canonical Rule

- `RelatedPerson` is subject-side index data.
- it should be taught through `Communication` as the auditable exchange envelope.
- the canonical semantics still live in `resource.meta.claims`.
- direct `RelatedPerson/_batch` routes are compatibility or lower-level runtime paths, not the first mental model for v2.

## Canonical Semantics

- relationship data belongs to the indexed individual context
- it is not employee lifecycle
- it should follow the same v2 exchange model as other individual index data

## Payload Source Of Truth

- GW shared fixture:
  [FAMILY_MEMBER_RELATIONSHIP_MESSAGE in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared SDK flow guidance:
  [gdc-sdk-core-ts/docs/101-SDK_FLOWS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-SDK_FLOWS.md)
- shared communication layering:
  [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)

## Runtime Compatibility Note

If a deployment or runtime still exposes:

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`

treat it as a lower-level or compatibility route.

Do not use that route-first shape as the primary v2 teaching model.

## Related Tests

- `gwtemplate-node-ts/src/__tests__/unit/managers/RelatedPersonManager.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/utils/swagger-spec.test.ts`

## Out Of Scope

- employee create/search/disable/purge
- host onboarding
- teaching direct route-first `RelatedPerson` ingestion as the default v2 path
