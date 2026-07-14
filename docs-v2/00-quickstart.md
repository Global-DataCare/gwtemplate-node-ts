# 00 Quickstart

> 101 note
> - This is part of the current GW entrypoint in `docs-v2`.
> - Start the self-managed user story upstream with `login -> loadProfile -> actor facade`, then come here for GW runtime/contract validation.
> - Read [101-README.md](./101-README.md) for the current ordered path.

Objective: run API, validate health, run one core test flow.

1. Install deps: `npm install`
2. Start API local: `npm run api:local-demo` (or repo equivalent)
3. Health check: `GET /host/.well-known/ping`
4. Run targeted tests (core first):
- Communication/Composition/DocumentReference
- Then extension tests (if any)

## Read first (context that must not be skipped)

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md) and the repository
governance in [ARCHITECTURE.md](../ARCHITECTURE.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md).

Current user-story boundary:

- profile/session/runtime bootstrap lives upstream in `gdc-sdk-node-ts` or
  `gdc-sdk-front-ts`
- for the individual-controller journey, that upstream bootstrap includes
  `loadProfile(...)`, creating the loaded-profile workspace, and registering
  the trusted device before any GW `startIndividualOrganization(...)` call
- payload authoring lives upstream in shared GDC helpers and SDK contracts,
  not in this GW quickstart
- this GW quickstart begins after that point, when the actor already exists
  and needs GW routes/contracts/runtime behavior

Before authoring payloads or integrations, read these source-of-truth docs:

- [BFF and channel message flow 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
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
- `docs-v2/19-key-custody-and-audit-readiness.md`
