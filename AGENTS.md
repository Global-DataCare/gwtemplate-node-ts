# AGENTS.md - gwtemplate-node-ts

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

## Purpose
Reference GW backend for asynchronous secure ingestion, indexing, and search across supported resource families.

Primary references:
- `README.md`
- `docs/API_INTEGRATORS_GUIDE.md`
- `docs/02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md`
- `docs/01-OVERVIEW-AND-GUIDES/01.G-TESTING-PATTERNS.md`
- `docs/UC_CAPABILITY_MATRIX_SEDIA.md`
- `docs/TESTING.md` / `docs/TESTING-E2E.md`

## Scope Governance
1. Keep core GW scope explicit and testable.
2. Features outside current core narrative must be documented as extension scope, not mixed into core acceptance criteria.
3. OpenAPI/examples/tests must describe actual behavior, not aspirational behavior.

## Hard Rules
0. In production each Kubernetes pod/process must unwrap the encrypted service
runtime KEK exactly once through KMS during bootstrap. Inject that process-owned
resource from `buildInfrastructure`; tenant operations use it locally and must
not call KMS. Do not add a singleton/global registry or shared plaintext key.
Google KMS is the current production root; preserve an adapter boundary for
future AWS KMS/multi-root support. `KEK_SECRET` remains local/demo custody and
must not be represented as the audited production profile.
1. Manager logic is deterministic and claim-driven.
2. Search semantics must be explicit:
- accepted query params
- 0..n result behavior
- OperationOutcome behavior for errors.
3. For DocumentReference indexing/retrieval:
- `DocumentReference.identifier` is logical identifier (UUID/URN)
- `DocumentReference.contenthash` is content hash/CID
- hash-based retrieval must use canonical claim name (`contenthash`), with legacy aliases only if documented.
4. Communication atomic profile constraints must not be presented as native FHIR limitations.
5. Activation controller checks must consume shared policy from `gdc-common-utils-ts` (no duplicated local role parsing).
6. Canonical examples/docs keep these dimensions separate:
- legal-representative and technical occupations use ISCO-08;
- tenant controller authority uses bare `RESPRSN` in
  `ServiceControllerCredential.credentialSubject.owner.additionalType`;
- avoid `|RESPRSN` as canonical output.
7. Every new persistence manager is claims-first:
- `resource.meta.claims` is the canonical business source of truth;
- persist flat claims as `ConfidentialStorageDoc.content.claims` through
  `protectConfidentialData`, never a version-specific nested FHIR resource;
- build `indexed.attributes` from the governed searchable claim subset and
  protect it with `protectAttributesNameAndValue` before repository storage;
- materialize native FHIR only at an explicit import, projection or export
  adapter boundary;
- the mandatory manager test must inspect the exact argument passed to
  `protectConfidentialData`, prove protected attributes, and reject nested FHIR
  fields as persisted business state.

## Naming Discipline
1. Keep the common concept first and the specialization last.
2. Prefer names such as:
- `UserProfileIndexStoreInMemory`
- `UserProfileIndexStoreFirestore`
- `UserProfileVaultFirestore`
3. Avoid inverted names such as:
- `InMemoryUserProfileIndexStore`
- `FirestoreUserProfileIndexStore`
4. The reason is programming/autocomplete consistency across backend and SDK runtimes.

## TDD Policy
For any endpoint/manager behavior change:
1. Add failing unit test in manager layer.
2. Add/adjust integration test in route layer.
3. Validate SDK live E2E impact when core flow is affected.
4. For every new persistence manager, add the claims-first storage gate from
   Hard Rule 7 before implementation.

## Quality Gates
- Portal evidence follows `test -> local-network -> test-network -> network`.
  First prove normal local UI -> BFF -> high-level SDK -> GW/services with
  in-memory `networkKind=test` and no blockchain. Fixture pages, mocked routes
  and API-only Playwright never replace that cross-system proof. Fabric,
  staging and production follow in that order.
- Every affected package or SDK live E2E must run against the real local
  services. A live E2E reported as `SKIP` blocks the release. Finish those live
  E2E gates before `npm publish` or any container image build.
- Type/build scripts as applicable.
- Unit: `npm run test:unit` or targeted jest files.
- Integration: `npm run test:integration` or targeted jest files.
- E2E (when needed): `npm run test:e2e`.
- Swagger/profile sync when changing contract/examples:
  - `npm run build:swagger`

## Core Test Anchors
- `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- `src/__tests__/unit/managers/DocumentReferenceManager.test.ts`
- `src/__tests__/integration/composition.bundle-search.api.test.ts`
- `src/__tests__/unit/adapters/activation-trust.adapter.test.ts`

## Live E2E Execution Policy
For real core validation, use orchestration script instead of ad-hoc direct test command:
- `./scripts/run-secure-e2e-google-user.sh`

Collect and preserve audit artifacts:
1. `gw-secure-e2e-*.log`
2. `live-gw-http-trace-*.jsonl`
3. `live-gw-uc5-debug-*.jsonl`

## Release Discipline
- Branch closure is indivisible. One behavior or flow branch owns one patch
  release. Do not open or start another fix/feature branch until the current
  branch has completed red-green TDD, every required no-skip test layer,
  changelog, package and lockfile patch, branch commit and push, explicit merge
  commit, pushed `main`, matching remote refs and a clean worktree.
- Shared-package promotions run from the lowest changed dependency upward:
  publish and verify each immutable package, then pin that exact registry
  version in the next consumer. Never advance a consumer with an unpublished,
  Git, file, workspace or vendored substitute.
- Environment promotion is ordered and cumulative:
  `test -> local-network -> test-network -> network`. A later environment never
  substitutes for an earlier gate, and any affected live E2E reported as
  skipped blocks image build and deployment.
- This repository is a deployable service, not an npm package. Keep
  `package.json#private` set to `true` and preserve the failing
  `prepublishOnly` guard; never run or document `npm publish`. Release
  immutable container images to Artifact Registry and deploy them by digest.
- Update `CHANGELOG.md` under `Unreleased` with explicit endpoint/manager effects.
- Keep docs and API examples synchronized with test-proven behavior.
