# Docs Governance (GW Core)

Date: 2026-05-20

## Why this exists

The repository has grown and documentation is split between numbered folders and top-level docs.
This file defines what is canonical and what is transitional/legacy.

## Canonical Structure

- `docs/01-OVERVIEW-AND-GUIDES`
- `docs/02-API-AND-ENDPOINTS`
- `docs/03-IDENTITY-AND-TRUST`
- `docs/04-DEEP-DIVES`
- `docs/scenarios`

These folders are the canonical navigation and should be kept updated first.

## Top-Level Docs Policy

Top-level docs under `docs/` that are not in numbered folders are allowed only when:
1. they are temporary migration notes, or
2. they are cross-cutting runbooks not yet normalized.

Every such file must include one of these labels in the first 10 lines:
- `Status: Canonical`
- `Status: Transitional`
- `Status: Legacy`

## Core vs Extension Boundary

GW core docs must not include UNID/UHC operational logic (`Task`/`Appointment` reminders, chat channel internals).
Those belong in UNID/UHC repositories.

## Cleanup Rule

When touching any legacy/transitional doc, either:
1. move it into canonical numbered structure, or
2. add a clear link in `docs/README.md` under a "Transitional" section.
