# 06 Security Model and Why

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

## Why this stack exists

The platform is designed for high-assurance health/document exchange where:
- identity and authorization must be auditable,
- payload integrity/confidentiality must be explicit,
- interoperability must survive heterogeneous clients and legacy integrations.

## Why FAPI-like posture

A FAPI-grade posture reduces common API abuse risks:
- token replay,
- weak client binding,
- ambiguous authorization contexts,
- insecure redirect/token exchange patterns.

Operational consequences:
- explicit client registration and token exchange discipline,
- strong bearer handling and short-lived artifacts,
- endpoint contracts that support secure polling for async flows.

## Why keep legacy-compatible paths

Legacy-compatible routes/claims exist to avoid hard cutovers in active deployments.
Rule:
- canonical contracts are preferred,
- compatibility aliases are temporary and must be tracked as TODO,
- no new feature should be designed only around legacy shapes.

## Why claims-first, FHIR-shaped

The platform needs two things at the same time:

- interoperable resource shapes that developers can recognize,
- a stable canonical claim layer that survives cross-sector, cross-runtime, and legacy translation boundaries.

That is why the project uses FHIR-shaped resources plus a project-specific `resource.meta.claims` container instead of requiring FHIR-pure payloads for every operational flow.

This is also why new clients are taught to construct `Communication` FHIR-like resources, not internal gateway-only models such as `CommMsgExtended`.

## Threat model summary

Primary threats considered:
- impersonation of actors/tenants,
- payload tampering in transit,
- replay of async job artifacts,
- over-broad data access due to weak scope boundaries.

Controls are distributed across:
- request validation,
- scoped routing/contracts,
- cryptographic verification paths,
- auditable async submit/poll model.

## Fabric authorization is not ledger identification

Keep host authorization, per-tenant read/write authorization and live-ledger
identity as three independent controls. A block-zero SHA-256 fingerprint proves
which ledger a named channel belongs to; it does not grant channel membership
or permission to write. Conversely, simulated authorization tests do not prove
that a deployed GW reached the intended live ledger.

See [27-fabric-authorization-and-ledger-binding.md](./27-fabric-authorization-and-ledger-binding.md)
for the current manual bootstrap limitation and the signed-governance-manifest
target.

## Key custody boundary

For the current operational custody model and the explicit audit caveat around
`KEK_SECRET`, read:

- [19-key-custody-and-audit-readiness.md](./19-key-custody-and-audit-readiness.md)

Read next:

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [API_CORE_INTEGRATION.md](../docs/API_CORE_INTEGRATION.md)
