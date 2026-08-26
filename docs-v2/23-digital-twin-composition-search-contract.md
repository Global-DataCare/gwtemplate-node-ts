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
- `MedicationStatement.code = http://snomed.info/sct|108575001`

- `section = LOINC|8716-3`
- `Observation.code = http://loinc.org|85354-9`

## Public parameter semantics

Section parameters:

- `section`
- `composition.section`

Resource-scoped coded filters accepted by the current implementation use the
canonical `<ResourceType>.<claim>` name, for example:

- `MedicationStatement.code`
- `Observation.code`
- `Condition.code`

Current support rule:

- research discovery uses machine-readable codes retained by the research-safe
  projection
- tests should exist for each supported section/resource pair
- `display`, narrative `text`, local text, and free-text matching are not part
  of this contract because those values are removed from research data

Matching semantics are exact coded-claim matching after the gateway's normal
claim/token normalization.

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
- one source IPS document/version is represented by one indexed Composition;
  all of its IPS section tokens are retained as a multi-valued
  `Composition.section` claim. Search by section returns that same Composition
  once rather than one synthesized Composition per matching section.

## Secondary-use withdrawal and reactivation

The subject-level research rule uses:

- `Consent.purpose = HRESCH` (`HealthcareConsentPurposes.Research`)
- `Consent.action = organization/ResearchSubject.rs`
- `Consent.decision = permit | deny`

`deny` is a reversible disable:

- stop subsequent synchronization into that projection
- retain the source clinical record, confidential pseudonymous alias, consent
  decision, already published anonymous twin, and audit history
- do not attempt to recall copies or derived results already lawfully exported
  to an external research environment; those remain governed by the applicable
  contract, permit, retention, and deletion obligations

A later `permit` reuses the stable private alias and performs a complete
rebuild from the current operational record. This incorporates changes made
while publication was disabled and avoids replaying a stale snapshot.

`purge` is intentionally not used for ordinary withdrawal. It is the index
provider offboarding operation for account deletion or provider migration. It
deletes only the provider-private operational-subject ↔ twin UUID
correspondence. It does not delete the anonymous twin. A later enrollment
allocates a new `urn:uuid` and cannot reconnect or update the detached twin.

The subject BFF invokes this through
`individual/org.hl7.fhir.r4/ResearchSubject/_purge`; the request is a FHIR
`Parameters` resource containing the operational `subject` DID.

## Search, Working Selection, and Materialization

This contract intentionally separates:

1. discovery
- `digitaltwin/.../Composition/_search`
- returns 0..n matched twin `Composition` indexes

2. working-selection persistence
- when the researcher chooses a match, the client may save a separate
  researcher-owned `Composition` through `digitaltwin/.../Composition/_batch`
- the selection keeps the matched pseudonymous `Composition.subject`, the
  employee DID in `Composition.author`, and ledger-safe `meta.tag[]`
- the canonical twin is not modified and no clinical data is copied
- a workset is reopened through `Composition/_search` with
  `Composition.meta-tag = system|code`
- direct batch rejects canonical twin writes, operational subject DIDs, and
  invented UUID URNs absent from the tenant-private alias registry

3. materialization
- happens after the researcher chooses or reopens one or more matched twins
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
- `Composition/_batch` answers "save this employee's tagged working selection"
- `Composition.meta-tag` answers "which saved selections belong to this exact
  coded workset/status/cohort?"
- `ResearchSubject/$summary` answers "materialize this twin in a concrete
  representation"

### Researcher tags

Tags are organization-defined working metadata, not clinical claims. Only the
ledger-safe fields `id`, `system`, `code`, optional `version`, and optional
`userSelected` are retained. `display`, free text, names, and individual
identifiers must not be stored in a tag.

Example working-selection metadata:

```json
{
  "claims": {
    "Composition.subject": "urn:uuid:00000000-0000-4000-8000-000000000101",
    "Composition.author": "did:web:api.acme.org:employee:researcher-1:ISCO-08|2211",
    "Composition.section": "LOINC|10160-0"
  },
  "tag": [
    {
      "id": "Composition.meta.tag[0]",
      "system": "urn:acme:research:workset",
      "code": "study-2026-04",
      "userSelected": true
    }
  ]
}
```

The exact recovery filter is
`Composition.meta-tag = urn:acme:research:workset|study-2026-04`.

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
5. project one multi-section `Composition` index per IPS document/version into
   `digitaltwin`
6. call `digitaltwin/.../Composition/_search` with:
   - `section`
   - one or more resource-scoped coded filters for the same family
7. receive matched `Composition` results
8. save one selected twin as a tagged working-selection `Composition`
9. reopen it by exact `Composition.meta-tag = system|code`
10. materialize its `Composition.subject` through
    `Communication -> ResearchSubject/$summary`

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
