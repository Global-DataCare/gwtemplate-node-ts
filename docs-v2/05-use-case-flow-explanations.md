# 08 Use-Case Flow Explanations

This section explains the intent behind the core operational flow shape.

## Baseline flow pattern

1. Client submits canonical payload (`_batch` style where applicable).
2. Backend validates and accepts async job (`202`).
3. Client polls response endpoint with correlation id (`thid`).
4. Backend returns final bundle/outcome (`200` success or structured error).

## Why async submit/poll

- decouples gateway availability from downstream latency,
- supports auditable retries and controlled processing,
- provides deterministic integration contract for operators.

## Canonical write/read split

- Write path favors canonical communication/document ingestion.
- Read path favors bundle/document retrieval and indexed attributes.

## Research digital twin push flow

For research-oriented digital twin updates, do not teach a cross-tenant pull
model where the research tenant reads directly from every provider tenant.

The v2 operational model is:

1. an individual controller grants a research authorization through consent or
   equivalent policy,
2. the tenant that maintains the individual's operational index receives the new
   index update,
3. that source tenant evaluates whether a specific anonymization or
   `digitaltwin` receiver is authorized for that subject and purpose,
4. if authorized, the source tenant emits a derived and anonymized payload to
   the receiver's `digitaltwin` ingestion endpoint,
5. the receiver stores the result in its separate research/digital twin scope.

Important separation rules:

- tenant `Service.*` claims describe published service capability, not a
  subject-specific research authorization,
- the individual authorization is separate from tenant service publication,
- the source tenant pushes derived anonymized artifacts, not its full
  operational index,
- the receiver is identified by its public `did:web` and resolved
  `didDocument.service[].serviceEndpoint`.

Current GW-aligned transport choice:

- for individual operational index exchange, teach `Communication`,
- for research digital twin ingestion, teach
  `digitaltwin/org.hl7.fhir.api/Composition/_batch`,
- the emitted batch may contain multiple `body.data[]` entries.
- for the still-missing separate research store and cross-twin search plan, see
  [20-research-digital-twin-store-and-search-plan.md](./20-research-digital-twin-store-and-search-plan.md)
  That plan also records the narrower MVP already implemented today:
  tenant-scoped medication twin mirroring and search by canonical text/code
  claims.

## Why Communication is central

`Communication` is the canonical auditable request envelope for several cross-resource flows.

That does not mean clients send FHIR-pure `Communication` in isolation.
The operational model is:

1. transport envelope,
2. batch container,
3. FHIR-shaped `Communication` resource with project claims where needed.

The shared explanation lives here:

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)

## IPS summary/read note

Current deployments may still expose legacy-compatible search-oriented paths.
The target summary-oriented contract is `Subject/$summary`, with `Patient/$summary` as a compatibility alias for healthcare-facing tooling.

Use summary semantics when teaching the intent of the flow.
Only teach legacy `_search` shapes when the example is explicitly documenting compatibility.

## Debugging checklist by flow step

- Submit fails: verify route scope/format/action and bearer mode.
- Poll not found: verify `thid`, queue/store wiring, and job lifecycle.
- Semantic mismatch: verify canonical claim ids (`resource.meta.claims`) and resource-type routing.
