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
5. Define the canonical individual-member licensing and relationship activation track:
   - reuse the employee-style license pool / `License/_issue` mechanics where applicable
   - auto-consume the first individual-member seat for the individual controller
   - model the default baseline as 2 seats / 0 EUR with no payment proof requirement
   - keep `RelatedPerson` as the final active relationship projection rather than the raw invitation state
   - expose a stable query surface for active related profiles derived from `resource.meta.claims`

## NEXT
1. Tighten OperationOutcome semantics for empty/malformed search requests where needed.
2. Expand integration coverage for `api` vs fixed FHIR-version path behavior symmetry.
3. Harden strict security-mode path documentation and tests.
4. Add canonical list/query support for active individual-member relationships so portal/BFF code can resolve `related-profiles` without reimplementing GW semantics.

## LATER
1. Advanced profile support (additional validator adapters/profiles).
2. Additional extension-only feature migrations to separate scope docs.
