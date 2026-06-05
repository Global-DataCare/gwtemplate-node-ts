# 02 API Contracts

Canonical write/read model:

- Write: `Communication/_batch` or the resource-specific canonical `_batch` route.
- Read: canonical search/retrieval routes plus document/composition resolution.
- Index rule:
  - index-oriented operations are transported through `Communication`
  - `Communication/_batch` is the canonical secure exchange envelope for index flows
  - one batch may carry one or more `Communication` entries

Current versus target summary rule:

- legacy-compatible reads may still expose `_search`-style shapes,
- new summary-oriented teaching should prefer `Subject/$summary`,
- `Patient/$summary` is an alias, not the canonical cross-sector name.

Canonical claim carrier:

- `resource.meta.claims`

Important:

- `resource.meta.claims` is project-specific and non-standard.
- It is FHIR-shaped, but not part of base FHIR.
- Claims are often contextualized with `@context` such as `org.schema` or `org.hl7.fhir.api`.
- When the active `@context` already disambiguates a claim, the key can remain less-qualified instead of repeating the full prefix everywhere.

FHIR naming:

- Use canonical SearchParameter-style keys when the claim models a FHIR search/retrieval semantic.
- Do not introduce ad hoc camelCase claim ids.
- Prefer shared constants from shared packages instead of string literals.

## Wire model that developers must remember

GW CORE expects:

1. DIDComm/FAPI envelope.
2. Batch business body.
3. FHIR-shaped resources inside entries.

Do not confuse these fields:

- transport `type`
- batch entry internal message kind
- FHIR `resourceType`

See:

- [Communication layering 101](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [API_CORE_INTEGRATION.md](../docs/API_CORE_INTEGRATION.md)
