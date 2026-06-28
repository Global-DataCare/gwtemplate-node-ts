# 99 Migration Map from docs/

This file maps legacy/transitional docs to docs-v2 targets.

- top-level transitional docs -> summarized in docs-v2/*
- numbered deep docs remain source detail when needed
- `docs/90.A-API_INTEGRATORS_GUIDE.md` -> `docs-v2/09-api-integrators-guide.md`
- `docs/90.B-API_FAMILY_INTEGRATORS_GUIDE.md` -> `docs-v2/09-api-integrators-guide.md` plus family-specific future v2 split when needed

Important rule:

- `docs-v2/*` is the recommended reading path for new developers.
- `docs/90.*` remains transitional and may still contain compatibility-oriented shapes or historical context.
- If a `docs/90.*` section conflicts with `docs-v2/*`, `docs/API_CORE_INTEGRATION.md`, or the shared 101 docs in sibling repositories, prefer the canonical/shared docs.

Source-of-truth references used by both docs trees:

- [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [101-RESOURCE_CLAIMS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-RESOURCE_CLAIMS.md)
- [101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- [API_CORE_INTEGRATION.md](../docs/API_CORE_INTEGRATION.md)

Current v2 additions introduced directly in `docs-v2/*`:

- [18-organization-controller-lifecycle.md](./18-organization-controller-lifecycle.md)
- [20-research-digital-twin-store-and-search-plan.md](./20-research-digital-twin-store-and-search-plan.md)
  This v2 plan explicitly separates the implemented tenant medication twin MVP
  from the proposed separate research-store rollout.
- [21-research-digital-twin-technical-backlog.md](./21-research-digital-twin-technical-backlog.md)
  This v2 backlog converts the digital twin plan into code-targeted work
  streams for config, adapters, and the first explicit search contract.
- [23-digital-twin-composition-search-contract.md](./23-digital-twin-composition-search-contract.md)
  This v2 contract document is the short operational read for the now-tested
  `digitaltwin/.../Composition/_search` route, accepted parameters, and
  section-to-resource support matrix.
