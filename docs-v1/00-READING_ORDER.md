# 00 - Reading Order (GW Core)

Status: Canonical

## Read First (mandatory order)

1. `docs-v1/README.md`
2. `docs-v1/DOCS_GOVERNANCE.md`
3. `docs-v1/01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md`
4. `docs-v1/02-API-AND-ENDPOINTS/02.D-API-CORE-INTEGRATION.md`
5. `docs-v2/README.md`
6. `docs-v1/01-OVERVIEW-AND-GUIDES/01.H-GW-CORE-CONTRACT-MAP.md`
7. `docs-v1/02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md`
8. `docs-v1/02-API-AND-ENDPOINTS/02.B-ROUTING.md`
9. `docs-v1/02-API-AND-ENDPOINTS/02.E-OPENAPI-PROFILES.md`
10. `docs-v1/01-OVERVIEW-AND-GUIDES/01.J-HIGH-LEVEL-TUTORIAL-BOUNDARIES.md`

## Research-related boundaries to understand first

These concepts may start from similar health information, but they are not the
same dataset or lifecycle:

- **Isolated public statistics:** one coded, de-identified event with a random
  identifier. It cannot be correlated with a person, a stable index, another
  report or a Digital Twin, and it does not belong to a `ResearchStudy`.
- **Study-specific Digital Twin:** an individual explicitly chooses one
  `ResearchStudy`. GW verifies the permission and source data before creating a
  separate pseudonymous research projection for that study. Another study is a
  separate choice, consent and twin identity.
- **Private tenant research import:** a professional organization may import
  spreadsheet or governed-conversion rows into its own tenant and add them to a
  tenant-managed research subject. Those rows remain tenant data; import does
  not make them public statistics or personal study participation.
- **Verified clinical source:** this is provenance, not another research
  collection. Professional origin is checked on the protected operational
  record before de-identification. A self-report remains self-reported.

The same source may enter public statistics and a study only through
independent explicit actions. No identifier or correlation link is shared
between those outputs. Treat this as an architecture contract; verify runtime
and environment evidence separately before claiming it is active.

Role responsibilities:

- A client application may expose isolated-statistics and study-participation
  actions, but must present them as independent choices and requests.
- A study operator owns its `ResearchStudy` catalogue and the study-specific
  Digital Twins created only from explicitly shared data.
- An authorized professional tenant may publish a `ResearchStudy` and import
  private research data. A clinical registration may separately request an
  isolated statistical contribution, but neither action changes the ownership
  or correlation boundaries described above.

## Then (by need)

- Identity/trust: `docs-v1/03-IDENTITY-AND-TRUST/*`
- Deep dives: `docs-v1/04-DEEP-DIVES/*`
- Scenarios: `docs-v1/05-USE-CASES/*`

Recommended audit-specific read:

1. `docs-v1/06-AUDIT-AND-EVIDENCE/06.A-SEDIA-CAPABILITY-EVIDENCE-MATRIX.md`
2. `docs-v1/02-API-AND-ENDPOINTS/02.C-DATASPACE-DID-SERVICES.md`
3. `docs-v1/04-DEEP-DIVES/04.F-LOCAL-TOPOLOGY-AND-FABRIC-ENV-LOADER.md`
4. `docs-v1/06-AUDIT-AND-EVIDENCE/06.G-CORE-TEST-EVIDENCE.md`

`docs-end/*` is closure/history material and is never a current architecture
source. `deliverables/*` is evidence packaging and cannot redefine component
ownership. Superseded notes and examples are removed from the published docs;
their provenance remains recoverable from Git history.
