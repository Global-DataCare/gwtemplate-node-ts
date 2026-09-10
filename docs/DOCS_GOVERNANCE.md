# Docs Governance (GW Core)

Date: 2026-09-10

## Why this exists

The repository has grown and documentation is split between numbered folders and top-level docs.
This file defines what is canonical and what is transitional/legacy.

## Canonical structure and precedence

- `docs/01-OVERVIEW-AND-GUIDES`
- `docs/02-API-AND-ENDPOINTS`
- `docs/03-IDENTITY-AND-TRUST`
- `docs/04-DEEP-DIVES`
- `docs/scenarios`

These folders own detailed architecture and API reference. `docs-v2/` is the
current short reading path for runtime/integrator guidance. The following
precedence removes ambiguity:

1. implemented behavior and generated OpenAPI;
2. `docs/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md` for component
   ownership and SEDIA boundaries;
3. `docs/API_CORE_INTEGRATION.md` for the demonstrated SEDIA GW/ICA/Fabric
   flow;
4. `docs-v2/*` for current integrator/runtime guidance;
5. numbered deep dives for subsystem detail;
6. transitional material;
7. `docs-end/*` project history, which never defines current behavior.

`deliverables/*` describes the evidence package but must not redefine the
architecture. If it conflicts with a canonical source, correct the deliverable
before publication.

## Top-Level Docs Policy

Top-level docs under `docs/` that are not in numbered folders are allowed only when:
1. they are temporary migration notes, or
2. they are cross-cutting runbooks not yet normalized.

Every such file must include one of these labels in the first 10 lines:
- `Status: Canonical`
- `Status: Transitional`

Superseded material does not remain in the published `docs/` tree. Git history
preserves its provenance without presenting obsolete designs or examples to
integrators and evaluators.

## Core vs Extension Boundary

GW CORE documentation must not include product-specific operational logic,
branding or examples. Product extensions belong in their owning repositories.

The `globaldatacare.es` portal/BFF owns organization-controller publication in
Pontus-X. GW CORE and dataspace ICA documentation may describe that external
boundary, but must not claim to reproduce, simulate or own it.

## Cleanup Rule

When touching transitional material, either promote it into the canonical
numbered structure or retain its explicit transitional label. Delete superseded
designs, examples and completed plans from the published documentation; rely on
Git history when historical reconstruction is necessary.
