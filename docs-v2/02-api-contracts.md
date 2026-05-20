# 02 API Contracts

Canonical write/read model:
- Write: `Communication/_batch` (or equivalent canonical ingestion path)
- Read: `Bundle/_search` + document/composition retrieval

Canonical claim carrier:
- `resource.meta.claims`

FHIR naming:
- Use canonical SearchParameter-style keys (no ad hoc camelCase).
