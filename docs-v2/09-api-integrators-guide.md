# 09 API Integrators Guide

Purpose:

- give new integrators one canonical mental model for GW CORE,
- avoid legacy route drift,
- point to the shared source-of-truth docs for claims, communication layering,
  and SDK behavior.

This is the v2 guide.

Use `docs/90.A-API_INTEGRATORS_GUIDE.md` only as v1/transitional reference.

## Read First

- [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [101-RESOURCE_CLAIMS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-RESOURCE_CLAIMS.md)
- [101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- [API_CORE_INTEGRATION.md](../docs/API_CORE_INTEGRATION.md)

## Core Rules

1. The canonical business contract lives in `resource.meta.claims`.
2. `resource.resourceType` is only the outer shape or projection.
3. `Communication` is the canonical auditable exchange envelope for individual index data.
4. `Communication.contentdata` is the canonical claim for embedded payload data.
5. Versioned FHIR payloads are optional projections or compatibility inputs.
6. If versioned FHIR is submitted, backend extraction/normalization derives the canonical stored claims.

## Wire Model

The current canonical wire model is:

1. DIDComm/FAPI envelope
2. batch body
3. one or more entries carrying resources whose semantics live in `resource.meta.claims`

Do not confuse:

- `DidComm.type`
- batch `entry.type`
- `resource.resourceType`
- `resource.meta.claims`

## Discovery

Public discovery remains separate from secure exchange.

Use discovery to resolve:

- DID document
- service endpoints
- JWKS
- OpenID metadata
- SMART metadata

Do not treat public discovery routes as data-exchange routes.

## Canonical Exchange Model

For v2, operations over individual index data are taught through `Communication`.

This includes:

- consent-related data
- document/index updates
- summary-oriented exchanges
- related-person relationship data
- related notifications bound to indexed data

Teaching rule:

- new integrators should not start from direct resource-specific ingestion routes
- new integrators should start from the `Communication` envelope plus canonical claims

## Canonical Flow Map

### Host onboarding

Use host/operator activation routes and proofs as described in:

- [10-host-organization-activate.md](./10-host-organization-activate.md)

### Individual index bootstrap

Use the tenant-level individual bootstrap flow to create the indexed individual context.

- [11-individual-index-bootstrap.md](./11-individual-index-bootstrap.md)

### Consent and access policy

Treat consent as governed index data.

The important rule is:

- the canonical semantics are still claims-first
- consent-related exchange belongs to the same `Communication`-centric index model

### Index ingestion and updates

Use `Communication` as the secure exchange envelope.

Embedded payload data should be modeled first as:

- `Communication.contentdata`

If a versioned FHIR document is additionally carried, it is a projection around that canonical semantic model.

- [12-communication-batch-index-data.md](./12-communication-batch-index-data.md)

### Summary retrieval

Target summary semantics are:

- `Subject/$summary`

Healthcare-facing alias:

- `Patient/$summary`

Do not teach legacy `_search` forms as the primary summary model in v2.

- [13-subject-summary-operation.md](./13-subject-summary-operation.md)

### SMART token

- [14-smart-token.md](./14-smart-token.md)

### Related person

- [15-related-person-index-data.md](./15-related-person-index-data.md)

## SDK Guidance

Use shared/runtime packages in this split:

- `gdc-common-utils-ts`
  shared constants, examples, cryptography, DID helpers
- `gdc-sdk-core-ts`
  claims-first builders, draft/outbox helpers, runtime-neutral contracts
- `gdc-sdk-node-ts`
  Node runtime submit/poll orchestration
- `gdc-sdk-front-ts`
  frontend/native session and runtime orchestration

Start here by runtime:

- [gdc-sdk-node-ts/docs/101-SDK_INTEGRATION.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-SDK_INTEGRATION.md)
- [gdc-sdk-front-ts/docs/101-SDK_INTEGRATION.md](https://github.com/Global-DataCare/gdc-sdk-front-ts/blob/main/docs/101-SDK_INTEGRATION.md)

## What Is Intentionally Out Of V2

These stay in v1/transitional docs:

- legacy `_search` teaching paths for summary retrieval
- direct route-first teaching for index operations
- old examples centered on `Consent/_batch` as if it were the primary index envelope
- examples that teach versioned FHIR payloads before canonical claims
- mixed compatibility payloads presented as first-choice onboarding material

## Mapping From V1

- `docs/90.A-API_INTEGRATORS_GUIDE.md`
  historical and transitional detail
- `docs/90.B-API_FAMILY_INTEGRATORS_GUIDE.md`
  family-specific transitional profile
- `docs-v2/*`
  canonical reading path for new integrators

## Payload Example Policy

- v2 docs should not hand-maintain payload examples in markdown when a shared fixture already exists
- use GW/shared test fixtures and tests as the payload source of truth
- prefer linking to fixture exports and conformance tests instead of copying large JSON blocks into docs
