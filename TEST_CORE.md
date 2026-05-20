# TEST_CORE - gwtemplate-node-ts

Purpose: define what the GW core profile must keep proving through tests and cross-repository live validation.

This file is the canonical GW-side summary for the core-memory baseline.

## Scope

From the GW repository point of view, the core baseline is demonstrated through two complementary test layers:

1. Local GW contract tests in this repository
- manager behavior
- route semantics
- payload normalization
- claim-name correctness
- Communication and `DocumentReference` persistence invariants

2. Live SDK-against-GW core tests from the SDK repositories
- `dataspace-client-sdk-node/TEST_CORE.md`
- `gdc-sdk-node-ts/TEST_CORE.md`

The reason for using both is simple:
- GW alone proves internal contract correctness
- SDK live E2E proves that those contracts are consumable end to end from real clients

## Core Validation Table

| Validation layer | Test source | What it proves for GW core | Main evidence |
| --- | --- | --- | --- |
| GW unit contract | `src/__tests__/unit/managers/CommunicationManager.unit.test.ts` | `Communication` handling, channel-record persistence, canonical claim usage, and atomic `DocumentReference` extraction behavior remain stable | unit test output in GW repo |
| GW unit contract | `src/__tests__/unit/managers/DocumentReferenceManager.test.ts` | Atomic `DocumentReference` behavior uses canonical claims and expected storage semantics | unit test output in GW repo |
| GW integration contract | `src/__tests__/integration/composition.bundle-search.api.test.ts` | Bundle-based search behavior and async route semantics match the documented core retrieval contract | integration test output in GW repo |
| SDK live core proof | `../dataspace-client-sdk-node/tests/live-gw-uc5.e2e.test.mjs` | The documented GW core flow is executable end to end from the legacy Node SDK | SDK JSONL traces + pass/fail status |
| SDK live new-runtime proof | `../gdc-sdk-node-ts/tests/live-gw-node-runtime.e2e.test.mjs` | The new actor-scoped Node runtime already interoperates with real GW core | SDK JSONL traces + pass/fail status |

## Core flow covered end to end through SDK live tests

The live cross-repo proof covers these GW core capabilities:
- host activation from ICA proof
- host order acceptance and organization-controller bootstrap
- individual/family organization start and order confirmation
- consent grant
- SMART token issuance
- Communication-based ingestion and indexed retrieval
- RelatedPerson emergency-contact baseline
- bearer/security-mode expectations

## Suggested naming convention

Use `TEST_CORE.md` in each core repository as the short, stable entry point.

Recommended meaning:
- `TEST_CORE.md`: what proves the core baseline and why it matters
- `TEST_MATRIX.md`: the broader testing taxonomy for the repository
- `API_CORE_INTEGRATION.md`: the step-by-step canonical flow and routes

## Relationship to other docs

- Canonical flow: `docs/API_CORE_INTEGRATION.md`
- Broader GW test taxonomy: `TEST_MATRIX.md`
- Docs index: `docs/README.md`
