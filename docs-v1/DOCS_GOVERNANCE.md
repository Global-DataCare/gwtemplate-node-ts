# Docs Governance (GW Core)

Date: 2026-09-10

## Why this exists

The repository documentation is split into a concise current guide (`docs-v2`)
and the numbered detailed reference (`docs-v1`). This file defines their
scope and precedence.

## Canonical structure and precedence

- `docs-v1/01-OVERVIEW-AND-GUIDES`
- `docs-v1/02-API-AND-ENDPOINTS`
- `docs-v1/03-IDENTITY-AND-TRUST`
- `docs-v1/04-DEEP-DIVES`
- `docs-v1/05-USE-CASES`
- `docs-v1/06-AUDIT-AND-EVIDENCE`

These folders own detailed architecture and API reference. `docs-v2/` is the
current short reading path for runtime/integrator guidance. The following
precedence removes ambiguity:

1. implemented behavior and generated OpenAPI;
2. `docs-v2/*` for current integrator/runtime guidance;
3. `docs-v1/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md` for component
   ownership and SEDIA boundaries;
4. `docs-v1/02-API-AND-ENDPOINTS/02.D-API-CORE-INTEGRATION.md` for the demonstrated SEDIA GW/ICA/Fabric
   flow;
5. the remaining numbered `docs-v1` references for subsystem detail;
6. `docs-end/*` project history, which never defines current behavior.

`deliverables/*` describes the evidence package but must not redefine the
architecture. If it conflicts with a canonical source, correct the deliverable
before publication.

## Numbering policy

All detailed Markdown references live in their numbered `docs-v1` section and
use the `<section>.<letter>-<subject>.md` form. Only the root index, reading
order and this governance file remain at the top level. `docs-v2` uses one
continuous numeric sequence beginning at `00`.

Superseded material does not remain in either published documentation tree.
Git history preserves its provenance without presenting obsolete designs or
examples to integrators and evaluators.

## Core vs Extension Boundary

GW CORE documentation must not include product-specific operational logic,
branding or examples. Product extensions belong in their owning repositories.

The external portal/BFF owns organization-controller publication in Pontus-X.
GW CORE and dataspace ICA documentation may describe that external
boundary, but must not claim to reproduce, simulate or own it.

## Cleanup Rule

Delete superseded designs, examples and completed plans from the published
documentation; rely on Git history when historical reconstruction is
necessary.
