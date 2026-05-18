# TEST_MATRIX - gwtemplate-node-ts

## Goal
Guarantee endpoint contract correctness and manager behavior for async GW flows.

## Levels
1. Unit tests
- Manager logic
- utility behavior
- mapping/normalization helpers

2. Integration tests
- Route-level async submit/poll
- payload compatibility wrappers (`data[]`/`entry[]`)
- search semantics (`Bundle/_search`)

3. E2E tests
- End-to-end workflows over running server components

## Commands
- Full: `npm test`
- Unit: `npm run test:unit`
- Integration: `npm run test:integration`
- E2E: `npm run test:e2e`
- Local demo API: `npm run api:local-demo`

## Current Critical Contract Tests
- `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- `src/__tests__/unit/managers/DocumentReferenceManager.test.ts`
- `src/__tests__/integration/composition.bundle-search.api.test.ts`

## Exit Criteria
- Unit + integration green for touched contracts
- API docs/examples aligned with actual behavior
- No undocumented claim-name drift
