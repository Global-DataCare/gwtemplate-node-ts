# Contributing

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing managers, routes,
queue adapters, storage adapters, or gateway-facing examples.

## Main Rule

`gwtemplate-node-ts` owns actual GW backend behavior.

Keep here:

- route contracts the gateway really exposes
- manager orchestration
- policy enforcement
- storage and queue adapter orchestration
- integration and E2E verification of real GW behavior

Do not move runtime-neutral primitives here when they belong in
`gdc-common-utils-ts`.

Do not document SDK aspirations here as if the gateway already exposed them.

## Module Hygiene Rule

Keep source files structurally clean:

- one exported class per file
- exported types in dedicated model/contract files
- reusable helper functions in helper modules
- do not mix exported types, helper implementations, and multiple exported
  classes in one file

Inside manager methods, keep only gateway orchestration that truly belongs to
the manager. Move reusable parsing, flattening, claim normalization, DIDComm
plaintext wrapping, and shape conversion logic into helper modules or shared
packages when the behavior is runtime-neutral.

## Layer Boundary Rule

When a flow spans app/frontend, BFF/runtime, and GW:

- frontend/app builds business payloads such as `Bundle`, `Communication`, or
  `DocumentReference`
- BFF/runtime wraps them as DIDComm plaintext JSON and then signs/encrypts
  unless the mode is plain/FHIR-compat
- GW receives, verifies, decrypts, decodes, validates, persists, and replies

GW tests and docs should state that split explicitly instead of collapsing all
responsibilities into one vague "communication manager" narrative.

## TDD Rule

For any manager or route behavior change:

1. Add or update the failing unit test first.
2. Add or update the failing integration test when the route contract changes.
3. Implement the minimum change to pass.
4. Refactor without changing behavior.

Include:

- one positive path
- at least one negative/validation path
- compatibility behavior when aliases or legacy inputs are still accepted

## Naming Rule

- keep the common concept first and the specialization last
- prefer explicit backend names that describe actual gateway operations
- avoid inventing new literals when lower-layer shared fixtures already exist
