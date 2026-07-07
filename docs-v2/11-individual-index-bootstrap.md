# 11 Individual Index Bootstrap

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- create the tenant-side indexed individual context,
- keep the v2 mental model separate from legacy family/onboarding drift.

## Canonical Endpoint Family

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch`
- poll:
  `.../_batch-response`

## Canonical Rules

- this creates the indexed individual context under the tenant/provider model.
- this is not the same as legal-organization onboarding.
- keep provider/operator identity separate from individual/controller identity.

## Payload Source Of Truth

- GW shared fixture:
  [FAMILY_REGISTRATION_TRANSACTION_REQUEST in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- GW shared fixture:
  [FAMILY_ORDER_REQUEST in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared SDK flow guidance:
  [gdc-sdk-core-ts/docs/101-SDK_FLOWS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-SDK_FLOWS.md)

## Related Tests

- `gwtemplate-node-ts/src/__tests__/integration/individual/family.test.ts`
- `gwtemplate-node-ts/src/__tests__/integration/individual/family.multimail.test.ts`
- `gwtemplate-node-ts/src/__tests__/integration/individual/family.multiphone.test.ts`

## V2 Boundary

- this document covers bootstrap only
- individual index data exchange after bootstrap belongs to `Communication`
