# TODO - gwtemplate-node-ts

Roadmap references:
- `TODO_ROADMAP.md`
- `docs/TODO_SMART_EHR_COMPAT.md`
- `docs/UC_CAPABILITY_MATRIX_SEDIA.md`

## NOW
0. Support the additive MVP Bundle-change/readback contract documented in
   `../gdc-sdk-core-ts/docs/MVP_BUNDLE_CHANGE_RECONCILIATION_PLAN.md`:
   - response entries remain correlatable to submitted new/modified resources
     by stable identifier
   - Composition, Consent, RelatedPerson and supported resource `_search`
     results remain subject-scoped and authoritative
   - submit/poll acknowledgement is not documented as persistence confirmation
   - add partial-failure and ambiguous-submit readback integration coverage
     without changing current MVP routes
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
6. Keep GW repo boundaries explicit:
   - GW may consume network-domain values but should not become the source of truth for veterinary segmentation taxonomy
   - finer animal network taxonomy belongs in `uhc-sdk-core-ts`
   - ICA-specific onboarding naming should stay documented first in ICA/workspace docs
7. Close the payment-proof licensing gap:
   - accept payment proof uploaded by frontend
   - verify payment proof in backend
   - activate the licenses tied to the paid `offer` / `order`
   - keep current backend license-update logic as the authoritative activation layer
8. Add canonical consent-management query/update surface:
   - list/search consents for controller views with actor-type filters
   - support grouped consent editing flows that expand into atomic rules
   - add stable operations for update/add/remove/disable/enable/delete once route semantics are fixed
   - preserve vault persistence, diff/hash inputs, and future blockchain anchor handoff
9. Add stable `RelatedPerson` query/filter surface for frontend/BFF:
   - emergency contacts
   - professional invitations/contacts
   - individual/family contacts
   - filter by coding/category and actor identifier pattern (`did:web`, email, phone)
10. Add stable clinical-import surface for "Agregar datos":
   - accept document plus `section`, `clinical date`, `code.display`, and target resource family metadata
   - generate/persist the claims needed for later FHIR R4 / IPS consolidation
   - keep import/search/retrieval semantics aligned across `Communication`, `DocumentReference`, and consolidated IPS output
11. Complete unified-view / IPS functional surface:
   - filter resources by section
   - filter resources by clinical date/date range
   - expose/recover `code.text`
   - reuse existing XHTML narrative when present
   - generate XHTML from `meta.claims` when narrative is missing
   - keep consolidated IPS output aligned with section/date/resource-type filters
12. Complete cross-operator/cross-ICA catalog aggregation and publish the normalized discovery API contract for portal/backend consumers.

## NEXT
1. Tighten OperationOutcome semantics for empty/malformed search requests where needed.
2. Expand integration coverage for `api` vs fixed FHIR-version path behavior symmetry.
3. Harden strict security-mode path documentation and tests.
4. Add canonical list/query support for active individual-member relationships so portal/BFF code can resolve `related-profiles` without reimplementing GW semantics.
5. Add integration coverage for payment-proof verification -> order/offer activation -> license-seat materialization.
6. Add integration coverage for grouped-consent update/diff/hash flows and actor-type consent filters.
7. Add integration coverage for emergency/professional/family `RelatedPerson` filters and guided clinical-import metadata.
8. Add integration coverage for unified-view / IPS section/date filters and XHTML reuse/generation.

## LATER
1. Advanced profile support (additional validator adapters/profiles).
2. Additional extension-only feature migrations to separate scope docs.
