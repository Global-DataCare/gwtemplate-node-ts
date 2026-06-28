# 21 Research Digital Twin Technical Backlog

Purpose:

- convert the research/digital twin plan into implementation slices tied to
  real files in this repository,
- keep the current `MedicationStatement` MVP explicit,
- define the next backlog in an order that preserves honest contracts and TDD.

Scope note:

- this backlog is still extension scope,
- it does not upgrade the current MVP into a fully implemented separate
  research store,
- proposed file targets below are implementation anchors, not statements of
  completed behavior.
- where the current repo already implements a first-cut version, that state
  should be written explicitly instead of being left aspirational.

## Current Code Anchors

The current implementation baseline is:

1. `Communication` can carry a JSON attachment that is either:
   - a `Bundle` with `type = document`, or
   - a `DocumentReference` whose `content[0].attachment` contains that bundle
2. `CommunicationManager` projects supported resources from that attachment
   into operational tenant sections.
3. supported projected IPS resources are mirrored into the tenant
   `digitaltwin` scope.
4. `CompositionManager` now provides the first public tenant-scoped
   `digitaltwin/.../Composition/_search` contract for section-first searches.
5. `MedicationStatementManager` still provides the older resource-scoped
   `digitaltwin` search MVP.

Architectural target to keep explicit while implementing:

- `individual` is the operational subject-read plane,
- `digitaltwin` is the research twin search plane,
- the long-term public `digitaltwin` search contract should return matched
  twin `Composition` indexes, not lists of matching leaf clinical resources,
- later twin document materialization should happen through a separate summary
  operation, not by overloading the search response itself into a final
  `Bundle` document.

Primary code anchors:

- [src/managers/CommunicationManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/CommunicationManager.ts:203)
- [src/managers/CommunicationManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/CommunicationManager.ts:875)
- [src/managers/CompositionManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/CompositionManager.ts:192)
- [src/managers/MedicationStatementManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/MedicationStatementManager.ts:61)
- [src/config/server-config.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/config/server-config.ts:139)
- [src/routes/api.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/routes/api.ts:1577)
- [docs-v2/23-digital-twin-composition-search-contract.md](./23-digital-twin-composition-search-contract.md)

## Backlog Principles

Rules for the backlog:

- do not break the current `MedicationStatement` MVP while introducing the
  separate store,
- do not present proposed cross-resource research search as already delivered
  in OpenAPI before the route exists,
- do not teach `individual` direct resource-type `_search` as the target read
  model,
- do not silently couple the research store to `POSTGRES_*`,
- keep claims-first extraction deterministic and allowlisted.

## Stream 1: `server-config.ts`

Goal:

- parse and validate explicit research-store config without changing current
  default runtime behavior.

Target files:

- [src/config/server-config.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/config/server-config.ts:1)
- [src/config.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/config.ts:1)
- [src/__tests__/unit/config/server-config.test.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/__tests__/unit/config/server-config.test.ts:1)

Backlog items:

1. Extend `IServerConfig` with a `researchStore` block instead of leaking new
   fields at top level.
2. Parse `RESEARCH_STORE_ENABLED`.
3. Parse `RESEARCH_STORE_PROVIDER`.
4. Parse `RESEARCH_STORE_SEPARATE_DB`.
5. Parse a dedicated PostgreSQL subsection:
   - `RESEARCH_STORE_POSTGRES_HOST`
   - `RESEARCH_STORE_POSTGRES_PORT`
   - `RESEARCH_STORE_POSTGRES_DB`
   - `RESEARCH_STORE_POSTGRES_USER`
   - `RESEARCH_STORE_POSTGRES_PASSWORD`
   - `RESEARCH_STORE_POSTGRES_SCHEMA`
   - `RESEARCH_STORE_POSTGRES_SSL`
6. Parse indexing options:
   - `RESEARCH_STORE_INDEX_PREFIX`
   - `RESEARCH_STORE_DEFAULT_LOCALE`
   - `RESEARCH_STORE_TEXT_SEARCH_MODE`
   - `RESEARCH_STORE_CODE_INDEX_MODE`
7. Validate the fallback rule:
   - if `RESEARCH_STORE_ENABLED=false`, do nothing new at runtime
   - if `RESEARCH_STORE_ENABLED=true` and `RESEARCH_STORE_SEPARATE_DB=true`,
     require dedicated research-store settings
   - if `RESEARCH_STORE_ENABLED=true` and
     `RESEARCH_STORE_SEPARATE_DB=false`, allow explicit reuse of main
     PostgreSQL settings but only as an intentional opt-in

TDD slice:

1. add failing config tests for default disabled behavior,
2. add failing config tests for dedicated PostgreSQL parsing,
3. add failing config tests for invalid provider/mode values,
4. add failing config tests for the explicit shared-db opt-in rule.

Definition of done:

- config can express research-store intent without changing any route or
  persistence behavior yet.

## Stream 2: Research Store Interfaces and Adapters

Goal:

- introduce a separate abstraction for the research/digital twin persistence
  plane instead of overloading `IVaultRepository`.

Why:

- `IVaultRepository` is tenant-vault oriented and section-based,
- the planned research store needs artifact, text-index, code-index, and audit
  persistence with different query semantics.

Target files:

- new `src/adapters` or `src/database/repositories/research-store/*`
- [src/database/repositories/vault/vault.repository.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/database/repositories/vault/vault.repository.ts:1)
- [src/managers/CommunicationManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/CommunicationManager.ts:875)
- [src/managers/MedicationStatementManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/MedicationStatementManager.ts:117)

Recommended interface split:

1. `IResearchTwinStore`
   - `putBatch(...)`
   - `putArtifacts(...)`
   - `putCodeIndexRows(...)`
   - `putTextIndexRows(...)`
   - `putAuditEvent(...)`
   - `search(...)`
2. `IResearchTwinProjector`
   - extract canonical searchable artifacts from accepted claims/resources
3. `IResearchTwinSearchNormalizer`
   - normalize `SYSTEM|CODE`
   - normalize locale/text query values

Recommended first adapter set:

1. `ResearchTwinStoreMemAdapter`
   - test-only or local baseline
2. `ResearchTwinStorePostgresAdapter`
   - first real target

Recommended first data types:

1. `ResearchTwinBatchRecord`
2. `ResearchTwinArtifactRecord`
3. `ResearchTwinCodeIndexRow`
4. `ResearchTwinTextIndexRow`
5. `ResearchTwinAuditEvent`

Implementation order:

1. define types and interfaces,
2. define a projector that consumes canonical claims already produced by the
   current managers,
3. write a memory adapter for deterministic unit tests,
4. wire the adapter factory from `server-config`,
5. only then add PostgreSQL persistence.

Pragmatic reuse rule:

- reuse the current `Communication -> document bundle -> projected claims`
  pattern,
- do not invent a second ingestion grammar for the research store,
- start by mirroring the existing `MedicationStatement` extraction semantics
  into the separate store before generalizing across all resource types.

TDD slice:

1. failing unit tests for claim extraction into artifact/code/text rows,
2. failing unit tests for `SYSTEM|CODE` normalization,
3. failing unit tests for `CodeDisplay` and `CodeTextLocal` normalization,
4. failing adapter tests for artifact persistence and search retrieval,
5. integration tests for separate-store writes without changing the current
   tenant-vault MVP.

Definition of done:

- research-store writes can be enabled behind config,
- the current tenant-vault mirror can still coexist during migration.

## Stream 3: Initial `digitaltwin` `_search` Contract

Goal:

- define a documented initial search contract that matches what the code can
  actually implement next.

Current truth:

- today the narrow implemented route is
  `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search`,
- it is tenant-scoped and `MedicationStatement`-specific,
- it is not yet the final cross-resource research search contract,
- it should be treated as a transitional MVP rather than the target public
  shape.

Target files:

- [src/routes/api.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/routes/api.ts:1577)
- [src/managers/MedicationStatementManager.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/managers/MedicationStatementManager.ts:199)
- [src/utils/swagger-spec.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/utils/swagger-spec.ts:1)
- `docs/openapi-profiles/*`
- [src/__tests__/unit/utils/swagger-spec.test.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/__tests__/unit/utils/swagger-spec.test.ts:1)
- [src/__tests__/integration/medication-statement.api.test.ts](/Users/fernando/GITS/gdc-workspace/gwtemplate-node-ts/src/__tests__/integration/medication-statement.api.test.ts:733)

Recommended contract progression:

### Step 3.1

Freeze and document the current `MedicationStatement` MVP semantics as a
transitional runtime behavior:

- accepted claims:
  - `MedicationStatement.code`
  - `MedicationStatement.medication-text`
  - `MedicationStatement.code-text`
  - `MedicationStatement.CodeDisplay`
  - `MedicationStatement.CodeTextLocal`
  - `MedicationStatement.note`
- exact match for code-like filters,
- case-insensitive substring match for approved text-like filters,
- zero results is `200`,
- malformed request is `OperationOutcome`.

### Step 3.2

Define the target `digitaltwin` public search shape on
`Composition/_search`.

Meaning:

- indexed claims from resources such as `MedicationStatement`,
  `Observation`, `Condition`, etc. may drive the match,
- but the returned public artifact is the matched twin `Composition` index,
- one result should correspond to one matched research subject / twin.

### Step 3.3

Define the target twin materialization contract separately from search.

Meaning:

- once the researcher has selected one or more matched twins, the client sends
  a `Bundle` of `Communication`
- each `Communication` requests `$summary` for one matched
  `ResearchSubject` / twin
- this is the digital-twin analogue of `individual -> Subject/$summary`

Target public shape:

- transport:
  - `Communication/_batch`
  - one `Communication` per requested twin
- operation target:
  - `digitaltwin/<format>/ResearchSubject/$summary`
- format-specific output:
  - `org.hl7.fhir.r4`
    - return a materialized `Bundle` document with rehydrated FHIR R4
      resources
  - `org.hl7.fhir.api`
    - return a claims-first bundle/resource set with `resourceType`, `id`,
      and `meta.claims`
- bundle entry identity:
  - prefer stable logical `entry.fullUrl` values such as `urn:uuid:...`
    instead of fake local paths
### Step 3.4

Add a request parser abstraction so the route contract is explicit instead of
implicitly reading arbitrary `meta.claims`.

Recommended request fields:

- `q`
- `code`
- `system`
- `resource-type`
- `source-tenant`
- `subject`
- `date-from`
- `date-to`
- `limit`
- `cursor`

Compatibility rule:

- the legacy claims-first request shape may remain temporarily,
- but the accepted parameter map must be documented and normalized in one
  place.

Recommended public route:

- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_search`

Recommendation:

- keep the current `MedicationStatement` route honest as a temporary MVP,
- evolve the documented target toward `Composition/_search`,
- do not document `Bundle/_search` as the target if the intended returned
  artifact is specifically a twin `Composition`.

TDD slice:

1. manager unit tests for accepted filters and malformed input,
2. route integration tests for `200` with zero results,
3. route integration tests for exact code search,
4. route integration tests for case-insensitive text search,
5. swagger tests so docs match the implemented route only.

Definition of done:

- the first public `_search` contract is explicit, testable, and not
  aspirational,
- and the output shape is clearly documented as matched twin documents rather
  than matching leaf resources.

## Dependency Order

Recommended execution order:

1. Stream 1
2. Stream 2
3. Stream 3

Reason:

- config must express intent first,
- adapters must exist before a separate-store-backed route can be honest,
- the public search contract should be tightened after persistence semantics
  are explicit.

## Minimum Safe Milestone

The smallest milestone worth shipping is:

1. `researchStore` config parsed and tested,
2. separate store interface plus memory adapter,
3. `MedicationStatement` artifact/code/text projection into that store,
4. no new public cross-resource route yet.

After that, the next safe milestone is:

1. PostgreSQL adapter,
2. deterministic text/code search over the separate store,
3. explicit documentation for the initial public `_search` contract.

## Out of Scope for This Backlog Slice

Do not mix these into the first implementation slice:

- generic search over every claim path,
- cross-tenant raw vault scanning,
- arbitrary document-bundle search across all resource families,
- operator authorization hardening beyond the current route surface,
- purge/revocation workflows before artifact persistence and audit fields are
  stable.
