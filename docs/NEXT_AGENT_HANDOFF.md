# NEXT AGENT HANDOFF - gwtemplate-node-ts

## Objective
Complete index-update flow for multi-document IPS ingestion and section-filtered retrieval with auth constraints.

## Clarified Rule
"Merge" means **index update** (section/reference accumulation), not arbitrary JSON merge.

## Required Behavior
1. Ingest document A and B for same subject (e.g., medication + allergy/condition/device).
2. Update index sections cumulatively.
3. `Bundle/_search` returns:
- all requested sections when no section filter,
- only requested sections when filter is present.
4. Respect consent/scopes in retrieval path.

## TDD Work Plan
1. Integration tests first (`src/__tests__/integration/*`):
- two-document ingestion scenario
- section-filtered search scenario
- unauthorized section/resource filtered-out scenario (scope/consent)
2. Unit tests for manager-level section accumulation logic.
3. Implement minimal manager updates.

## Resource/Claim Contract
- Use canonical flat claims from `gdc-common-utils-ts` only.
- DocumentReference:
  - `DocumentReference.identifier` = logical ID (UUID/URN)
  - `DocumentReference.contenthash` = CID/hash retrieval key

## API Integrator Docs Rule
- GW `API_INTEGRATORS_GUIDE.md` stays core-oriented and endpoint-centric.
- SDK method-level detail must reference SDK docs, not be duplicated.

## OpenAPI Rule
- Keep single OpenAPI profile in GW.
- Extensions are documented in extension repos/docs, not by splitting GW OpenAPI files.

## Logs / Traceability
Current observability requirement:
1. Gateway server logs (business/worker side).
2. SDK HTTP trace logs per call sequence.

Do not remove either path; ensure docs explain both.

## Acceptance Criteria
- Integration tests pass for two-document section accumulation and filtered retrieval.
- Contract docs updated and aligned with tests.
- `npm run test:integration` green for touched suites.
