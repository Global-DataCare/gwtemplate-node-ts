# 01 Architecture: Core vs Extension

Core scope:

- canonical transport and payload contracts,
- canonical resource shapes such as `Communication`, `Composition`, `DocumentReference`, `Consent`,
- validation and routing baseline,
- async submit/poll contract,
- interoperability rules that must stay stable across sectors.

Extension scope:

- operational domain logic,
- sector-specific flows,
- compatibility helpers,
- optional adapters that must remain subordinate to the core contract.

Rule:

- extension must not break core contracts,
- extension must not redefine the meaning of shared claims,
- extension may simplify a flow, but it must not teach a different wire model than CORE.

## Why the split exists

This split protects three things:

1. Stable contracts for SDKs and external integrators.
2. Cross-sector reuse for `health-*`, `animal-*`, and `onehealth-*`.
3. Clear separation between interoperable semantics and local deployment decisions.

Without that split, examples drift, claims drift, and different sectors start teaching different payload models for the same operation.

## `individual` vs `digitaltwin`

This distinction must stay explicit in code, docs, and route contracts.

`individual` means:

- the operational subject-index plane,
- auditable request/response flows centered on `Communication`,
- canonical read semantics centered on `Subject/$summary`,
- document/section retrieval when the caller wants the subject's operational
  summary or indexed document view.

`digitaltwin` means:

- a separate research-oriented twin plane,
- ingestion of derived/anonymized twin artifacts,
- cohort-style or twin-style search over indexed claims,
- public retrieval of matched twin indexes first, and later materialization
  into concrete document views rather than leaf clinical resource hits.

Practical rule:

- do not teach `individual` as a set of direct resource-type search endpoints
  such as `MedicationStatement/_search`, `Observation/_search`, etc.
- if such routes exist in the runtime for compatibility or narrow MVP reasons,
  document them as compatibility/runtime details, not as the architectural
  target model.
- for `digitaltwin`, the target public search surface is `Composition/_search`
  returning 0..n twin `Composition` indexes, while internal matching may still
  use claims derived from contained resources such as `MedicationStatement` or
  `Observation`.
- that `digitaltwin` search is section-first:
  clients filter by IPS section token first, for example `LOINC|10160-0`
  (`History of Medication Use`) or `LOINC|8716-3` (`Vital Signs`), and then
  by resource-scoped textual claims such as
  `MedicationStatement.code-display`, `MedicationStatement.code-text`,
  `Observation.code-display`, or `Observation.code-text`.
  The backend may fan out across the section's supported resource families,
  but the public result remains `Composition`, not leaf resources.

Materialization rule:

- the indexed twin `Composition` is not the same artifact as a materialized
  `Bundle` document
- the twin index is the search/discovery artifact
- the materialized document is a later projection derived from the stored
  claims representation
- the intended auditable transport for that projection request is a `Bundle`
  of `Communication`, each one targeting `ResearchSubject/$summary` for one
  matched twin

Format rule for materialized twin summaries:

- `org.hl7.fhir.r4`
  - return a materialized `Bundle` document with rehydrated FHIR R4 resources
- `org.hl7.fhir.api`
  - return a claims-first bundle/resource set where each resource keeps
    `resourceType`, `id`, and `meta.claims`

## Canonical source-of-truth docs

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [SDK package boundaries](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-SDK_PACKAGE_BOUNDARIES.md)
- [GW core integration baseline](../docs/API_CORE_INTEGRATION.md)
- [20-research-digital-twin-store-and-search-plan.md](./20-research-digital-twin-store-and-search-plan.md)
  This document now distinguishes the currently implemented tenant-scoped
  medication twin MVP from the still-proposed separate research-store
  architecture.
