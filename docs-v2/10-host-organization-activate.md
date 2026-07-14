# 10 Host Organization Activate

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- provide the legacy compatibility host activation route for callers that already start from ICA-backed proof,
- bind controller identity,
- publish the correct service capability semantics for discovery and runtime.

This route is not required after a successful `Organization/_transaction`.

## Legacy Compatibility Endpoint

- `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
- poll:
  `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response`

## Canonical Rules

- `vp_token` is the canonical proof carrier.
- service capability semantics are mandatory.
- the persisted claim is `org.schema.Service.serviceType`.
- this is not an individual-index `Communication` flow.
- this route is legacy compatibility, not the canonical continuation of `Organization/_transaction`.

## Canonical Variables

- `vpToken`
- `controller.did`
- `controller.sameAs`
- `controller.publicKeyJwk`
- `controller.jwks`
- `service.url`
- `service.capabilities`

## Payload Source Of Truth

- GW shared fixture:
  [ORGANIZATION_ACTIVATION_REQUEST in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared flow guidance:
  [API_CORE_INTEGRATION.md](../docs/API_CORE_INTEGRATION.md)
- SDK flow guidance:
  [gdc-sdk-core-ts/docs/101-SDK_FLOWS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-SDK_FLOWS.md)

## Related Tests

- `gwtemplate-node-ts/src/__tests__/unit/managers/HostingManager.activation.test.ts`
- `gwtemplate-node-ts/src/__tests__/integration/organizationApi.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/utils/swagger-spec.test.ts`

## What Is Out Of Scope Here

- legacy registration `_batch` as the first onboarding path
- employee lifecycle
- individual index data exchange through `Communication`
