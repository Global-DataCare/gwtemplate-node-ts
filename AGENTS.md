# AGENTS.md - gwtemplate-node-ts

## Purpose
Reference GW backend for asynchronous secure ingestion, indexing, and search across supported resource families.

Primary references:
- `README.md`
- `docs/API_INTEGRATORS_GUIDE.md`
- `docs/02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md`
- `docs/01-OVERVIEW-AND-GUIDES/01.G-TESTING-PATTERNS.md`
- `docs/UC_CAPABILITY_MATRIX_SEDIA.md`
- `TESTING.md` / `TESTING-GUIDE.md`

## Scope Governance
1. Keep core GW scope explicit and testable.
2. Features outside current core narrative must be documented as extension scope, not mixed into core acceptance criteria.
3. OpenAPI/examples/tests must describe actual behavior, not aspirational behavior.

## Hard Rules
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

## TDD Policy
For any endpoint/manager behavior change:
1. Add failing unit test in manager layer.
2. Add/adjust integration test in route layer.
3. Validate SDK live E2E impact when core flow is affected.

## Quality Gates
- Type/build scripts as applicable.
- Unit: `npm run test:unit` or targeted jest files.
- Integration: `npm run test:integration` or targeted jest files.
- E2E (when needed): `npm run test:e2e`.

## Core Test Anchors
- `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- `src/__tests__/unit/managers/DocumentReferenceManager.test.ts`
- `src/__tests__/integration/composition.bundle-search.api.test.ts`

## Release Discipline
- Update `CHANGELOG.md` under `Unreleased` with explicit endpoint/manager effects.
- Keep docs and API examples synchronized with test-proven behavior.
