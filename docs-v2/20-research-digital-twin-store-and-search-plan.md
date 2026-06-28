# 20 Research Digital Twin Store and Search Plan

Purpose:

- define the missing plan for a separate research/digital twin data store,
- define how authorized source tenants feed that store,
- define how cross-twin search should work over canonical claims,
- define the configuration and rollout plan without pretending it already
  exists in GW CORE today.

Status:

- this document is a plan,
- it does not describe a fully implemented runtime in the current repository,
- anything marked `proposed` must not be presented as current behavior in
  OpenAPI, examples, or tests until implemented.

Companion implementation backlog:

- [21-research-digital-twin-technical-backlog.md](./21-research-digital-twin-technical-backlog.md)
  This companion document maps the plan to concrete code targets such as
  `server-config.ts`, research-store adapters, and the initial `_search`
  contract backlog.

## Honest Current State

Today GW already has:

- canonical claims-first ingestion,
- tenant-scoped operational individual index flows,
- research/digital twin ingestion routes using
  `digitaltwin/org.hl7.fhir.api/Composition/_batch`,
- documentation for a push model from source tenant to authorized research
  receiver,
- an MVP tenant-scoped digital twin mirror for `MedicationStatement` updates,
- an MVP tenant-scoped digital twin search path that can find mirrored
  medication twins by canonical medication text or code claims.

Important architectural distinction:

- `individual` operational reads are not the same thing as `digitaltwin`
  search under another path,
- `individual` is centered on `Communication`, `Subject/$summary`, and
  document/section retrieval,
- `digitaltwin` is centered on twin ingestion plus twin/cohort search and
  should ultimately return matched twin documents (`Composition`), not just
  matching leaf clinical resources.

### Implemented today in this repository

The currently implemented runtime behavior is intentionally modest:

1. an operational medication update accepted for an individual can be mirrored
   into that same tenant's `digitaltwin` scope,
2. the mirrored twin artifact remains inside the current GW persistence plane,
   not in a separate research database yet,
3. the current searchable artifact family is `MedicationStatement`,
4. the current search filters are still route/resource-specific rather than a
   generic cross-resource research search API.

For the implemented medication MVP, the practical effect is:

- when an individual's medication is updated in the operational flow, the
  tenant can update the individual's mirrored digital twin medication record,
- the mirrored twin can then be found through
  `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search`,
- current search behavior supports exact code-style matches and case-insensitive
  text matches over canonical medication claims such as medication text,
  code-display, and local code text fields.

This current MVP must be read as transitional runtime behavior.

The target public search contract is not "search medications and return
medications". The target contract is:

- search `digitaltwin` using indexed claims derived from contained/related
  resources,
- return 0..n matched twin documents,
- where each returned document represents one matched research subject / twin.

Today GW does **not** yet define completely:

- a separate database contract for cross-tenant digital twin storage,
- the `.env` configuration that selects that store,
- the indexing strategy for cross-twin text and code search,
- the canonical search API for querying across all research twins,
- the authorization boundary for host/operator searches over that store.

This gap must be treated as extension backlog, not as already-delivered CORE.

## Architectural Rule

Keep three layers separate:

1. operational tenant index,
2. research/digital twin store,
3. host/operator search surface over that research store.

Do not collapse them into one persistence model.

Current implementation note:

- the medication mirror/search MVP intentionally proves the ingestion and
  search semantics first,
- it does not yet satisfy the full separate-plane architecture described in
  the rest of this document.

Reasons:

- operational tenant data and research-derived data have different policy and
  minimization rules,
- cross-tenant search needs a different indexing strategy than tenant vault
  storage,
- audit posture is clearer when derivation and destination are explicit.

## Recommended Runtime Model

### A. Source of truth

The operational tenant remains the source of truth for raw accepted index data.

That tenant:

- ingests the operational update,
- applies subject authorization policy,
- derives the research-safe artifact,
- pushes that artifact to the authorized receiver.

### B. Research receiver

The authorized research tenant receives the derived payload through its
`digitaltwin` endpoint and persists it into a separate research/digital twin
store.

That store is:

- not the same tenant vault used for operational confidential storage,
- not the same search model used for tenant-scoped operational reads,
- optimized for cohort-style filters and cross-resource research lookup.

### C. Host/operator search

The host or a privileged operator may expose search over that research store,
but only over the derived/anonymized artifacts already accepted into that
separate store.

The host does not read raw operational tenant vaults directly for this purpose.

## Persistence Plan

### Proposed storage split

Use two persistence planes:

1. tenant operational plane
   - existing tenant vault/storage/index behavior
2. research digital twin plane
   - separate database or schema dedicated to anonymized derived artifacts

Recommended first production shape:

- PostgreSQL for the research store metadata and searchable projections
- optional object/blob storage for large original attachments if needed
- explicit tables for:
  - received twin batches
  - twin artifacts
  - normalized search tokens
  - code indexes
  - provenance and audit events

If PostgreSQL is not chosen, the replacement must still support:

- structured filtering,
- text search,
- code lookup,
- provenance fields,
- predictable indexing and pagination.

## Why a separate database is recommended

Because the research workload needs:

- text search over derived claim values,
- code search across heterogeneous resource types,
- cross-tenant aggregation under policy,
- independent retention and purge policy,
- operational analytics without scanning tenant confidential storage.

Trying to overload the existing tenant vault abstraction for this use case
would blur confidentiality boundaries and produce poor search performance.

## Proposed configuration plan

The current config already has `DB_PROVIDER` and a `postgres` block for the
main application runtime.

That is not enough by itself because the research store needs an explicit
separate role.

### Proposed env keys

These names are proposed and not yet implemented:

- `RESEARCH_STORE_ENABLED=true|false`
- `RESEARCH_STORE_PROVIDER=postgres|supabase|firestore`
- `RESEARCH_STORE_SEPARATE_DB=true|false`
- `RESEARCH_STORE_POSTGRES_HOST`
- `RESEARCH_STORE_POSTGRES_PORT`
- `RESEARCH_STORE_POSTGRES_DB`
- `RESEARCH_STORE_POSTGRES_USER`
- `RESEARCH_STORE_POSTGRES_PASSWORD`
- `RESEARCH_STORE_POSTGRES_SCHEMA`
- `RESEARCH_STORE_POSTGRES_SSL=true|false`
- `RESEARCH_STORE_INDEX_PREFIX`
- `RESEARCH_STORE_DEFAULT_LOCALE`
- `RESEARCH_STORE_TEXT_SEARCH_MODE=postgres-simple|postgres-tsvector`
- `RESEARCH_STORE_CODE_INDEX_MODE=normalized-claims-v1`

Rule:

- do not silently reuse `POSTGRES_*` for the research store unless operators
  intentionally opt into `RESEARCH_STORE_SEPARATE_DB=false`
- production guidance should prefer a separate database or at minimum a
  separate schema with separate credentials

## Logical Data Model

The research store should not depend on one resource type only.

The ingestion contract may arrive as `Composition`, but search should project a
normalized twin-artifact model.

### Proposed tables

1. `research_twin_batches`
   - one accepted push from a source tenant to a receiver
   - stores receiver tenant, source tenant, authorization reference, and audit
     metadata

2. `research_twin_artifacts`
   - one derived searchable artifact
   - stores:
     - `artifact_id`
     - `receiver_tenant_id`
     - `source_tenant_id`
     - `subject_pseudonym`
     - `resource_type`
     - `artifact_type`
     - `claims_json`
     - `ingested_at`
     - `event_time`
     - `authorization_ref`
     - `status`

3. `research_twin_code_index`
   - normalized code rows extracted from claims
   - stores:
     - `artifact_id`
     - `claim_path`
     - `code_system`
     - `code_value`
     - `display_text`
     - `display_text_local`

4. `research_twin_text_index`
   - normalized text-search rows extracted from claims
   - stores:
     - `artifact_id`
     - `claim_path`
     - `text_kind`
     - `text_value`
     - `locale`
     - `normalized_text`

5. `research_twin_audit_events`
   - records ingestion, transformation, search access, and purge events

This is intentionally a projection model.
Do not query arbitrary JSON blobs only and call that a search architecture.

## Claim Indexing Strategy

Search must work on canonical claims, not on accidental frontend strings.

### Code-oriented indexing

Extract code-like claims into `research_twin_code_index`.

This includes claims shaped like:

- `*.code`
- `*.type`
- `*.category`
- `*.section`
- `*.method`
- `*.interpretation`

For values encoded as `SYSTEM|CODE`, normalize into:

- `code_system`
- `code_value`

If display text exists in a sibling claim, store it too.

### Text-oriented indexing

Extract human-readable searchable text into `research_twin_text_index`.

This includes claims shaped like:

- `*CodeText`
- `*CodeTextLocal`
- `*CodeDisplay`
- `*Display`
- `*.text`
- `*.note-text`
- other explicitly allowlisted research-safe free text claims

Important rule:

- do not index arbitrary raw narrative blindly
- index only allowlisted derived fields approved for the research store

### Canonical examples relevant to this plan

Typical search-worthy derived text claims may include:

- local-language code text such as `...CodeTextLocal`
- display-oriented text such as `...CodeDisplay`
- normalized note or label text that was already approved for research sharing

The exact allowlist must be documented in code once implemented.

## Search Semantics Plan

The first version must keep search semantics explicit and testable.

### Supported query families

1. exact code search
   - by `system`
   - by `code`
   - by `system+code`

2. display/text search
   - full-text or prefix search over normalized searchable text
   - optionally scoped by locale

3. structural filters
   - `receiverTenantId`
   - `sourceTenantId`
   - `resourceType`
   - `artifactType`
   - `subjectPseudonym`
   - time range

4. mixed search
   - code filter plus free-text filter plus time range

### Proposed query contract

The public route should converge on:

- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_search`

That route means:

- search over indexed twin claims,
- return matched twin documents (`Composition`),
- not "search one leaf clinical resource type and return those leaf resources".

The filter semantics should be:

- `q`
  free-text search over normalized text index
- `code`
  exact code value
- `system`
  exact code system
- `resource-type`
  resource/artifact filter
- `source-tenant`
  provenance filter
- `subject`
  pseudonymous subject filter
- `date-from`
  inclusive lower bound
- `date-to`
  inclusive upper bound
- `limit`
  page size
- `cursor`
  stable pagination cursor

Rule:

- do not expose ambiguous hidden search behavior
- every accepted query parameter must be documented
- zero results must be a normal success case
- malformed filters must return a structured error outcome

## Search API Scope Recommendation

Do not overload operational tenant `_search` routes for this plan.

Current implementation note:

- today there is a narrow tenant-scoped
  `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search` MVP,
- that endpoint is useful as a stepping stone for medication twin discovery,
- it must not be misdescribed as the final cross-resource or cross-tenant
  research search contract.

Recommended extension shape:

- a dedicated research/digital twin search route on `Composition/_search`
- clearly separated from operational patient/subject summary routes
- returning matched twin documents rather than matched leaf resources

Implemented contract note:

- the runtime now exposes a tested section-first
  `digitaltwin/.../Composition/_search` contract,
- the concise operational contract is documented in
  [23-digital-twin-composition-search-contract.md](./23-digital-twin-composition-search-contract.md),
- this plan remains the broader design/research document around separate-store
  evolution and later multi-resource expansion.

This route choice matters because the returned public artifact is intended to
be the twin document (`Composition`) itself.

## Authorization and Governance Plan

The research store must retain these fields on every artifact:

- authorized receiver tenant
- source tenant
- subject pseudonym
- authorization reference
- derivation policy/profile id
- ingestion timestamp

Search authorization must be distinct from ingestion authorization.

That means:

- "source tenant may push to receiver" is one permission,
- "operator may search across stored research twins" is another permission.

Do not assume one implies the other.

## Audit and Purge Plan

The research store needs explicit lifecycle rules for:

- acceptance of derived artifacts,
- reprocessing when derivation policy changes,
- receiver-tenant deactivation,
- subject-originated revocation where legally required,
- retention expiry,
- selective purge by authorization reference or subject pseudonym.

This should be documented before production rollout, not after.

## Phased Implementation Plan

### Phase 0: document and freeze semantics

- define this document,
- define explicit extension scope,
- define proposed env/config names,
- define accepted search parameter semantics.

### Phase 1: tenant-scoped MVP

Status: implemented in part for `MedicationStatement`.

- mirror accepted operational medication updates into tenant `digitaltwin`
  scope,
- expose one tenant-scoped digital twin medication search route,
- support deterministic text/code matching over canonical medication claims,
- keep the implementation inside the current GW persistence plane while the
  separate-store contract is still being designed.

This phase proves:

- update propagation from operational index flow to twin scope,
- canonical-claims search semantics for one artifact family,
- testable behavior before introducing separate database complexity.

### Phase 2: separate store wiring

Status: proposed, not implemented yet.

- add config parsing for `RESEARCH_STORE_*`,
- add storage adapter abstraction for the research store,
- persist accepted digital twin artifacts into separate research persistence,
- keep no public search route yet.

### Phase 3: normalized indexing

Status: proposed, not implemented yet.

- implement extraction from accepted claims into:
  - artifact table
  - code index table
  - text index table
- define the allowlist for searchable claim paths
- add deterministic normalization for code and text values

### Phase 4: explicit search API

Status: proposed, not implemented yet.

- add one canonical research search endpoint,
- document accepted filters,
- return deterministic pagination,
- add structured error behavior.

### Phase 5: policy and audit hardening

Status: proposed, not implemented yet.

- tie each stored artifact to authorization reference and derivation policy,
- add access audit events,
- add purge/revocation workflow,
- document operator authorization model.

## TDD and Quality Gates

No implementation should skip test definition for search semantics.

Minimum required tests when coding starts:

1. unit tests for claim extraction into code/text indexes,
2. unit tests for normalization of `SYSTEM|CODE`,
3. unit tests for `CodeTextLocal` and `CodeDisplay` tokenization/normalization,
4. integration tests for separate-store persistence,
5. integration tests for search filters and zero-result behavior,
6. integration tests for malformed query handling,
7. integration tests for provenance and tenant scoping,
8. purge/revocation tests when lifecycle behavior is introduced.

## Recommended First Deliverable

The first deliverable should be modest:

- persist research twin artifacts into a separate PostgreSQL schema,
- index exact code filters and basic normalized text search,
- support one explicit search endpoint,
- keep the searchable claim allowlist short and documented.

The currently implemented medication MVP is intentionally even smaller than
that first full deliverable:

- same-runtime twin mirroring instead of separate-store persistence,
- one resource family (`MedicationStatement`) instead of a generic artifact
  model,
- tenant-scoped search instead of cross-tenant research search.

Do **not** start with:

- arbitrary JSON deep-query promises,
- implicit fuzzy search over every claim,
- cross-tenant raw vault scans,
- undocumented automatic reuse of the main operational database.

## Final Rule

Until this plan is implemented, docs and API examples must continue to say:

- GW supports digital twin ingestion,
- GW teaches a push flow from source index tenant to authorized research
  receiver,
- GW currently implements a tenant-scoped medication twin mirror/search MVP,
- the separate research-store/search architecture is planned but not yet fully
  standardized in runtime configuration or public API.
