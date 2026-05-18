# TODO - gwtemplate-node-ts

Roadmap references:
- `TODO_ROADMAP.md`
- `docs/TODO_SMART_EHR_COMPAT.md`
- `docs/UC_CAPABILITY_MATRIX_SEDIA.md`

## NOW
1. Keep Communication->DocumentReference indexing/retrieval contract stable (`identifier` logical, `contenthash` retrieval hash).
2. Keep `Bundle/_search` behavior documented and tested for composition/docref search variants.
3. Keep API integrator docs aligned with implemented claim names.
4. Add integration coverage for two-document IPS section accumulation and section-filtered retrieval respecting permissions/scopes.

## NEXT
1. Tighten OperationOutcome semantics for empty/malformed search requests where needed.
2. Expand integration coverage for `api` vs fixed FHIR-version path behavior symmetry.
3. Harden strict security-mode path documentation and tests.

## LATER
1. Advanced profile support (additional validator adapters/profiles).
2. Additional extension-only feature migrations to separate scope docs.
