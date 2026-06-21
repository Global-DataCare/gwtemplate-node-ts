# 00 Quickstart

Objective: run API, validate health, run one core test flow.

1. Install deps: `npm install`
2. Start API local: `npm run api:local-demo` (or repo equivalent)
3. Health check: `GET /host/.well-known/ping`
4. Run targeted tests (core first):
- Communication/Composition/DocumentReference
- Then extension tests (if any)

## Read first (context that must not be skipped)

Before authoring payloads or integrations, read these source-of-truth docs:

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [IPS Communication outbox 101](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- [SDK node integration 101](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-SDK_INTEGRATION.md)
- [Core integration baseline for this GW](../docs/API_CORE_INTEGRATION.md)

## What GW CORE expects on the wire

GW CORE does not expect FHIR R4 JSON by itself.

The canonical client-facing shape today is:

1. A DIDComm/FAPI transport envelope.
2. A project batch body, usually `BundleJsonApi`.
3. One or more batch entries whose canonical semantics live in `resource.meta.claims`.

Important distinctions:

- `DidComm.type` is the transport/protocol message type.
- `BundleEntry.type` is a project-specific internal message kind. It is not FHIR.
- `resource.resourceType` is only the outer shape or projection.
- `resource.meta.claims` is the canonical project-specific claims contract. It is not part of base FHIR.
- `Communication.contentdata` is the canonical claim for embedded payload data.

Teaching rule:

- New clients should build canonical `resource.meta.claims` first.
- FHIR-shaped payloads are optional projections or compatibility inputs around that canonical claims model.
- New clients should not construct `CommMsgExtended` directly as their primary outbound payload.

## Read next

- `docs-v2/01-architecture-core-vs-extension.md`
- `docs-v2/02-api-contracts.md`
- `docs-v2/04-claims-and-fhir-rules.md`
- `docs-v2/05-use-case-flow-explanations.md`
- `docs-v2/06-security-model-and-why.md`
- `docs-v2/07-didweb-pqc-and-trust-chain.md`
- `docs-v2/09-api-integrators-guide.md`
- `docs-v2/17-clinical-bundle-readers.md`
