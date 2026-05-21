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

## Debugging checklist by flow step

- Submit fails: verify route scope/format/action and bearer mode.
- Poll not found: verify `thid`, queue/store wiring, and job lifecycle.
- Semantic mismatch: verify canonical claim ids (`resource.meta.claims`) and resource-type routing.
