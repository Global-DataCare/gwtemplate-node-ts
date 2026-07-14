# Narrative Alignment Contract

This file is the master contract for all 101-style docs, tests, snippets, and
example payload walkthroughs that are meant to teach a newcomer how the GDC
stack fits together end to end.

If a file teaches a local GW or SDK step, it must still explain the full story
around that step. No example should read like the whole architecture when it
only shows one slice of it.

## Why this exists

The stack has multiple layers that are easy to confuse when each repository
documents only its local surface:

- `gdc-common-utils-ts` teaches the front-story: login, profile/runtime unlock,
  payload authoring, and the first canonical shapes used by the app/BFF.
- `gdc-sdk-core-ts` teaches shared neutral contracts and helpers.
- `gdc-sdk-node-ts` and `gdc-sdk-front-ts` teach actor-aware runtime
  orchestration, including how a loaded profile turns into a working wallet
  context.
- `gwtemplate-node-ts` teaches the actual gateway contract: what the backend
  really receives, validates, queues, decrypts, persists, and returns.

If these layers are documented separately without a shared order, readers
incorrectly infer that a local example is the complete flow. This contract
prevents that drift.

## Required story order

Every 101 explanation must present the story in this order, even if some
steps are mocked in the local repo:

1. Login or authentication bootstrap.
2. `loadProfile(...)` or the equivalent runtime unlock step.
3. Loaded-profile workspace creation.
4. Wallet/key material selection from the loaded profile.
5. Security mode decision:
   - FHIR compatibility
   - `didcomm-plain+json`
   - strict FAPI JWE/JAR/JARM
6. If FHIR is used, name the version explicitly.
7. If strict mode is used, state which profile-owned keys are used for
   signing and encryption.
8. Only then explain the local GW route, queue, manager, or helper behavior.

## Canonical security narrative

The security story must be explicit in every teaching example:

- FHIR compatibility is a compatibility path, not the default story unless the
  example is intentionally about FHIR-shaped interoperability.
- `didcomm-plain+json` is an explicit transport choice, not a vague placeholder.
- strict mode means the loaded profile and its wallet material determine the
  outbound signed/encrypted envelope.
- if the example uses FAPI JWE/JAR/JARM, the doc must say so directly and must
  say where the envelope was created.
- if the profile exposes PQC-capable keys, the example should say that those
  profile-owned keys are the ones used for the envelope. GW does not invent or
  replace those keys.

## What each repository owns

### `gdc-common-utils-ts`

Use this repo to teach:

- login and user-story bootstrap
- the user-facing payload building story
- canonical claim construction
- examples that show how a developer starts from the front-story

Common-utils should not be asked to teach gateway internals. It should teach the
payload and runtime entry point that precedes GW.

### `gdc-sdk-core-ts`

Use this repo to teach:

- shared neutral helpers
- canonical contract primitives
- reusable example fixtures and models

### `gdc-sdk-node-ts` and `gdc-sdk-front-ts`

Use these repos to teach:

- `loadProfile(...)`
- loaded-profile wallet and key selection
- runtime-dependent envelope creation
- how the application decides whether it will send FHIR, plain DIDComm, or
  strict FAPI JWE/JAR/JARM

These repos are where the example should show the transition from profile to
working envelope.

### `gwtemplate-node-ts`

Use this repo to teach:

- what the gateway actually accepts on the wire
- how requests are decoded, queued, validated, and answered
- which canonical route contracts are exposed
- what compatibility modes are tolerated

GW docs and tests must not imply that the gateway itself performs the upstream
profile bootstrap.

## Writing rule for tests, snippets, and docs

Every teaching file must answer these questions somewhere in the text or
comments:

- What was mocked?
- Where does the real implementation live upstream?
- Why is this local example still useful?
- Is this canonical behavior or compatibility behavior?
- Which layer decides the transport/security mode?
- If the example is FHIR-shaped, what version is it?

If any answer is missing, the example is incomplete for 101 purposes.

## Reuse rule

Do not teach the same story differently in each repository.

- Common-utils should point to the front-story and payload-authoring path.
- SDK repos should point to the profile/runtime and wallet/envelope path.
- GW docs should point back upstream for profile/bootstrap and then describe the
  gateway contract.

The point is not to make every file long. The point is to make every file
honest about which part of the story it owns.

## Acceptance checklist

Before a 101 doc, test, or snippet is considered aligned, verify that it:

- starts with upstream profile/runtime context
- makes the security mode explicit
- states any FHIR version used
- identifies compatibility aliases when relevant
- explains what is mocked versus real
- points the reader to the correct upstream repo when the example does not own
  the full flow
- avoids presenting a local slice as the whole architecture

## Root references

The local governance files that must stay aligned with this contract are:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [docs-v2/01-narrative-contract.md](./docs-v2/01-narrative-contract.md)
- [README.md](./README.md)
