# Architecture

## Purpose

`gwtemplate-node-ts` is GW CORE. It owns backend route behavior, managers,
policy enforcement, storage orchestration, and the final runtime contract
actually exposed by the gateway.

This repository is the source of truth for:

- manager behavior
- route/endpoint behavior
- runtime policy enforcement
- integration and E2E verification of actual gateway behavior

This repository is not the place for:

- inventing neutral shared SDK abstractions first
- documenting aspirational SDK behavior as if it were already exposed

## Relationship To Shared Packages

GW CORE may consume shared neutral semantics from:

- `gdc-common-utils-ts`

GW CORE may align with contracts shaped by:

- `gdc-sdk-core-ts`
- `gdc-sdk-node-ts`
- `gdc-sdk-front-ts`

But the dependency of truth flows the other way for backend behavior:

- GW CORE defines what the gateway actually does
- SDKs and shared helpers must not over-document behavior that GW does not expose

## Layering Rule

Use the repositories in this order:

1. `gdc-common-utils-ts`
   - shared neutral semantics
2. `gdc-sdk-core-ts`
   - neutral domain facades
3. `gdc-sdk-node-ts` / `gdc-sdk-front-ts`
   - actor-aware runtime orchestration
4. `gwtemplate-node-ts`
   - actual backend contract and execution behavior

That does not mean GW is downstream from SDKs in authority. It means reusable
SDK semantics should be shaped cleanly before being specialized, while GW
remains the authority on real route/manager behavior.

## Runtime Queue And Vault Note

Current GW template implementation uses concrete backend adapters.

Today the default bootstrap path uses:

- `VaultMemRepository` for volatile in-process storage in the default memory
  setup
- `QueueAdapterMem` as the current in-memory queue adapter
- an in-process worker that consumes queued jobs and updates the async response
  store

This is suitable for:

- local development
- unit/integration tests
- reference flows where durability is not yet the target

It is not the final shape for durable multi-instance deployments. In a durable
GW deployment, the queue adapter may be replaced by a backend-specific adapter
while preserving the same route/manager contract.

## Naming Rule

At the gateway layer, endpoint and manager names must describe actual backend
operations and must not blur CRUD, search, lifecycle, or transport semantics.

Use explicit names and keep docs/examples aligned with tested behavior.

For specialized stores, vaults, and runtime adapters, keep the shared concept
first and the specialization suffix last, for example:

- `UserProfileIndexStoreInMemory`
- `UserProfileIndexStoreFirestore`
- `UserProfileVaultFirestore`

Avoid inverted names such as:

- `InMemoryUserProfileIndexStore`
- `FirestoreUserProfileIndexStore`

## Test And Contract Policy

GW tests must prove actual backend behavior, not aspirational SDK layering.

Preferred anchors:

- [src/__tests__/unit/managers/CommunicationManager.unit.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/unit/managers/CommunicationManager.unit.test.ts#L1)
- [src/__tests__/unit/managers/DocumentReferenceManager.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/unit/managers/DocumentReferenceManager.test.ts#L1)
- [src/__tests__/integration/composition.bundle-search.api.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/integration/composition.bundle-search.api.test.ts#L1)
- [src/__tests__/unit/adapters/activation-trust.adapter.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/unit/adapters/activation-trust.adapter.test.ts#L1)

High-level SDK examples may inspire the contract shape, but GW docs and tests
must only describe behavior that the gateway really exposes.

For core security-sensitive flows, keep the verification layers distinct:

- unit/integration Node tests prove deterministic manager and route behavior in
  memory
- live `local-network` audit scripts prove the deployed async GW + Fabric
  orchestration end to end

Current examples of that split:

- SMART token gating, route compatibility, and consent-rule matching are proven
  in Jest suites such as:
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
  - `src/__tests__/integration/identity/smart-token.test.ts`
  - `src/__tests__/integration/identity/research-access.conversation.test.ts`
- the corresponding live local audit path is exercised through:
  - `scripts/smoke-consentaccess-local-network.sh`
  - `scripts/smoke-consentaccess-lifecycle-local-network.sh`
  - `scripts/smoke-smart-access-local-network.sh`
  - `scripts/project-audit-demo.sh`

Do not collapse those live orchestration checks into ad-hoc unit-style tests,
and do not document shell live smokes as if they replaced the Node TDD layers.

## JSDoc And Literal Policy

Public manager/route helpers should use JSDoc to explain:

- the real runtime contract
- accepted claims/params
- lifecycle/search semantics
- what compatibility paths are tolerated vs canonical

When shared fixtures/examples already exist in lower layers, prefer aligning to
them semantically instead of inventing new unexplained literals.

## Module Hygiene Rule

Keep GW source files structurally clean:

- one exported class per file
- exported types in dedicated model/contract files
- reusable helper functions in dedicated helper modules
- do not mix exported types, helper implementations, and multiple exported
  classes in one file

At this layer, managers may still orchestrate multiple helpers, repositories,
and adapters, but reusable normalization, wrapping, parsing, and classification
logic should be pushed down into helpers or into `gdc-common-utils-ts` when the
behavior is runtime-neutral.

Communication-specific reminder:

- manager code should orchestrate gateway behavior
- reusable `Communication` shaping or DIDComm plaintext wrapping contracts
  should live in shared lower layers when they are not GW-specific
- GW tests should make the frontend/app vs BFF/runtime vs GW split explicit
  when the flow crosses those boundaries

## Extension Rule

If a GW variant such as `GW UNID` extends GW CORE, it should add its own
architecture note as a suffix/extension document over this baseline rather than
forking the core layering rules silently.
