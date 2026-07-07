# 23 Digital Twin Composition Search Contract

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- define the public search contract that is now actually implemented for
  `digitaltwin/.../Composition/_search`,
- keep the semantic split from `individual` explicit,
- give frontend and SDK developers one place to read the accepted search
  parameters, supported IPS sections, and expected result shape.

Reference IPS example used to validate the mapping and test fixture:

- `https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html`

## Intent

This route is not:

- a direct public `_search` over `MedicationStatement`,
- a direct public `_search` over `Observation`,
- or a generic "search every resource type in individual".

This route is:

- a `digitaltwin` search surface,
- section-first,
- claims-backed internally,
- and returns matched twin `Composition` indexes, not a fully materialized
  bundle document.

## Canonical route

Supported public routes:

- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_search`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_search`

Polling behavior:

- this flow is still asynchronous,
- submit with `_search`,
- poll the same `thid` on:
  - `.../digitaltwin/org.hl7.fhir.api/Composition/_batch-response`
  - or `.../digitaltwin/org.hl7.fhir.r4/Composition/_batch-response`

## Request model

The accepted public request shape is a FHIR `Parameters` resource carried in
the DIDComm/plain JSON body.

Teach the search contract from public request params first:

- `section`
- `Composition.section` / `composition.section`

Required parameters:

- `section`
- at least one resource-scoped claim filter

Current rule:

- one resource family per request
- multiple claim filters for that same resource family are allowed

Examples:

- `section = LOINC|10160-0`
- `MedicationStatement.code-display = lisinopril`
- `MedicationStatement.code-text = lisinopril`

- `section = LOINC|8716-3`
- `Observation.code-display = pressure`
- `Observation.code-text = pressure`

## Public parameter semantics

Section parameters:

- `section`
- `composition.section`

Resource-scoped text filters accepted by the current implementation:

- `<ResourceType>.code-display`
- `<ResourceType>.CodeDisplay`
- `<ResourceType>.code-text`
- `<ResourceType>.code-text-local`
- `<ResourceType>.CodeTextLocal`

Current support rule:

- every supported `section -> resourceType` mapping should accept both
  `code-display` and `code-text` textual matching
- tests should exist for each supported section/resource pair
- token/code exact matching and date/period range filters are planned next, but
  they are not the MVP contract today

Special compatibility rule for medications:

- `MedicationStatement.code-text` may match either:
  - `MedicationStatement.CodeTextLocal`
  - `MedicationStatement.medication-text`

Matching semantics:

- `code-display`
  case-insensitive partial text match
- `code-text`
  case-insensitive partial text match
- non-textual claims
  exact match

Current malformed-input rules:

- missing `section` => error
- missing resource-scoped claim filter => error
- more than one resource family in the same request => error

## Response model

Successful search returns:

- async completed `Bundle`
- first `data[]` item type:
  `Composition-search-response-v1.0`
- `resource.total`
- `resource.data[]`

Each `resource.data[]` item is a matched twin `Composition` projection/index
record.

Important:

- the result is not a list of matching `MedicationStatement` or `Observation`
  records,
- those leaf resources are internal matching inputs,
- the public artifact is `Composition`,
- and that `Composition` is the twin index/descriptor used to identify one
  matched `ResearchSubject` / digital twin.

## Search vs Materialization

This contract intentionally separates:

1. discovery
- `digitaltwin/.../Composition/_search`
- returns 0..n matched twin `Composition` indexes

2. materialization
- happens later, when the researcher chooses one or more matched twins
- the request should be carried in a `Bundle` of `Communication`
- each `Communication` asks for the summary of one matched
  `ResearchSubject` / twin

Target materialization semantics:

- `individual`
  - `Communication -> Subject/$summary`
- `digitaltwin`
  - `Communication -> ResearchSubject/$summary`

This means:

- `Composition/_search` answers "which twins match?"
- `ResearchSubject/$summary` answers "materialize this twin in a concrete
  representation"

## Materialized output formats

The research/digital twin store is claims-first.

Current architectural rule:

- the stored research artifact is the indexed twin claims representation
- concrete output formats are projections derived from that representation

Requested output format should control the response shape:

- `org.hl7.fhir.r4`
  - return a materialized `Bundle` document
  - `entry.resource` contains rehydrated FHIR R4 resources
  - `entry.fullUrl` should be a stable logical reference such as
    `urn:uuid:...` when no public resolvable URL exists

- `org.hl7.fhir.api`
  - return a claims-first bundle/resource set
  - each `entry.resource` keeps at least:
    - `resourceType`
    - `id`
    - `meta.claims`
  - `entry.fullUrl` may still be the same stable logical reference such as
    `urn:uuid:...`

## Supported IPS sections

Section token provenance:

- the gateway now exposes a local shared `HealthcareBasicSections` catalog that
  extends the upstream common-utils basic catalog with the IPS-specific summary
  sections still missing there
- the gateway also exposes `HealthcareSummarySections` as the IPS summary
  subset aligned with the official HL7 IPS all-sections example

Shared common-utils basic section constants that are intentionally outside that
official IPS summary example:

- `LOINC|60591-5` Patient Summary Document
- `LOINC|61144-2` Diet and Nutrition
- `LOINC|10157-6` History of Family Member Diseases
- `LOINC|46240-8` History of Hospitalizations and Outpatient Visits
- `LOINC|10164-2` History of Present Illness
- `LOINC|57852-6` Problem List Narrative Reported
- `LOINC|69730-0` Instructions

Current supported section-first contract:

| IPS section | token | public search family | internal sections |
|---|---|---|---|
| History of Medication Use | `LOINC|10160-0` | `MedicationStatement` | `medications` |
| Allergies and Intolerances | `LOINC|48765-2` | `AllergyIntolerance` | `allergies` |
| Problem List | `LOINC|11450-4` | `Condition` | `conditions` |
| Results | `LOINC|30954-2` | `Observation` or `DiagnosticReport` | `observations`, `diagnostic-reports` |
| Procedures | `LOINC|47519-4` | `Procedure` | `procedures` |
| Immunizations | `LOINC|11369-6` | `Immunization` | `immunizations` |
| Functional Status | `LOINC|47420-5` | `Condition` | `conditions` |
| Plan of Care | `LOINC|18776-5` | `CarePlan` | `care-plans` |
| Plan of Treatment | `LOINC|18776-5` | `CarePlan` | `care-plans` |
| Social History | `LOINC|29762-2` | `Observation` | `observations` |
| Vital Signs | `LOINC|8716-3` | `Observation` | `observations` |
| Advance Directives | `LOINC|42348-3` | `Consent` | `consents` |
| History of Past Illness | `LOINC|11348-0` | `Condition` | `conditions` |
| Pregnancy History | `LOINC|10162-6` | `Observation` | `observations` |
| Goals / Preferences | `LOINC|81338-6` | `Consent` | `consents` |

Frontend implication:

- the frontend should primarily expose section checkboxes/toggles,
- not raw resource-type selection as the first contract,
- but it may use the matrix above to decide which filters are available per
  section.

## Step-by-step test flow

The tested flow is:

1. send a `Communication/_batch` in `individual`
2. attach a `DocumentReference` or IPS document bundle
3. project supported clinical resources into `individual`
4. mirror those projected resources into `digitaltwin`
5. project one `Composition` index per IPS section into `digitaltwin`
6. call `digitaltwin/.../Composition/_search` with:
   - `section`
   - one or more resource-scoped text filters for the same family
7. receive matched `Composition` results

Concrete test anchors:

- [src/__tests__/unit/managers/CommunicationManager.unit.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/unit/managers/CommunicationManager.unit.test.ts#L1)
- [src/__tests__/unit/managers/CompositionManager.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/unit/managers/CompositionManager.test.ts#L1)
- [src/__tests__/integration/composition.bundle-search.api.test.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/integration/composition.bundle-search.api.test.ts#L1)

## Relationship to legacy/MVP routes

The earlier narrow MVP remains true:

- `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search`

But that route must be read as:

- a resource-specific stepping stone,
- not the main public target contract.

The target public contract is now:

- `digitaltwin/.../Composition/_search`
- section-first
- twin-document-first in the response

## SMART Authorization Compatibility

For the current GW profile, this public search contract is intentionally tied
to one research-oriented SMART root capability:

- token issuance for the `digitaltwin` search plane accepts
  `organization/ResearchSubject.rs...`
- `patient/ResearchSubject...` is rejected
- route-level enforcement rejects `Composition`-rooted clinical SMART tokens on
  `digitaltwin` endpoints

The corresponding clinical plane remains separate:

- `individual` access uses `organization/Composition.rs...`
- route-level enforcement rejects `ResearchSubject`-rooted tokens on
  `individual` endpoints

This keeps the runtime split explicit:

- `Composition` = clinical/index access plane
- `ResearchSubject` = research/digital-twin access plane

## Executable Proof

The current repository proves this contract at three levels:

1. manager/unit and route/integration tests for SMART token issuance and route
   compatibility
2. didactic in-memory research conversation proving:
   - inter-tenant contract VC presentation
   - `allow` and `deny` by employee role
   - `allow` and `deny` by direct employee email targeting
3. live `local-network` smoke proving:
   - consent rule anchoring on Fabric
   - SMART token issuance for `organization/ResearchSubject.rs`
   - `digitaltwin/.../Composition/_search` execution with the emitted token

Primary anchors:

- `src/__tests__/integration/identity/research-access.conversation.test.ts`
- `src/__tests__/integration/identity/smart-token.test.ts`
- `src/__tests__/integration/identity/smart-scope-route-gates.test.ts`
- `scripts/smoke-smart-access-local-network.sh`
- `scripts/project-audit-demo.sh`
