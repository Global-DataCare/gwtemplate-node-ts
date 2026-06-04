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
