# 00 - Reading Order (GW Core)

Status: Canonical

## Read First (mandatory order)

1. `docs/README.md`
2. `docs/DOCS_GOVERNANCE.md`
3. `docs/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md`
4. `docs/API_CORE_INTEGRATION.md`
5. `docs-v2/README.md`
6. `docs/01-OVERVIEW-AND-GUIDES/01.I-GW-CORE-CONTRACT-MAP.md`
7. `docs/02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md`
8. `docs/02-API-AND-ENDPOINTS/02.B-ROUTING.md`
9. `docs/OPENAPI_PROFILES.md`
10. `docs/01-OVERVIEW-AND-GUIDES/101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md`

## Then (by need)

- Identity/trust: `docs/03-IDENTITY-AND-TRUST/*`
- Deep dives: `docs/04-DEEP-DIVES/*`
- Scenarios: `docs/05-USE-CASES/*`

Recommended audit-specific read:

1. `docs/03-IDENTITY-AND-TRUST/03.I-HOSTING-OPERATOR-BOOTSTRAP-AUDIT.md`
2. `docs/03-IDENTITY-AND-TRUST/03.H-ICA-CERTIFICATE-ISSUANCE.md`
3. `docs/02-API-AND-ENDPOINTS/02.E-DATASPACE-DID-SERVICES.md`
4. `docs/90.F-UC_CAPABILITY_MATRIX_SEDIA.md`

## Transitional Top-Level Docs (not first-read)

These docs are transitional and should not be used as primary onboarding sequence:

- `docs/90.A-API_INTEGRATORS_GUIDE.md`
- `docs/90.B-API_FAMILY_INTEGRATORS_GUIDE.md`
- `docs/90.C-NEXT_AGENT_HANDOFF.md`
- `docs/90.H-END_TO_END_DEVICE_FLOW.md`
- `docs/90.I-IDENTITY-FABRIC.md`
- `docs/90.J-KEY_CUSTODY_RUNBOOK.md`

`docs-end/*` is closure/history material and is never a current architecture
source. `deliverables/*` is evidence packaging and cannot redefine component
ownership. Superseded notes and examples are removed from the published docs;
their provenance remains recoverable from Git history.
