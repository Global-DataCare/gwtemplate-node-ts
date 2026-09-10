# GW CORE detailed documentation (v1)

`docs-v2/` is the current concise integrator and runtime guide. `docs-v1/`
contains only detailed, code-backed references that remain useful. Superseded,
aspirational and product-specific material is retained in Git history, not in
the published documentation tree.

Start with [00-READING_ORDER.md](00-READING_ORDER.md). Precedence and retention
rules are defined in [DOCS_GOVERNANCE.md](DOCS_GOVERNANCE.md).

## 01 - Overview and guides

- [01.A Architecture overview](01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md)
- [01.B Credential architecture](01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md)
- [01.C Setup guide](01-OVERVIEW-AND-GUIDES/01.C-SETUP-GUIDE.md)
- [01.D Async endpoints](01-OVERVIEW-AND-GUIDES/01.D-IMPLEMENTING-ASYNC-ENDPOINTS.md)
- [01.E Tenancy and vault](01-OVERVIEW-AND-GUIDES/01.E-TENANCY-AND-VAULT.md)
- [01.F Testing patterns](01-OVERVIEW-AND-GUIDES/01.F-TESTING-PATTERNS.md)
- [01.G Deployment guide](01-OVERVIEW-AND-GUIDES/01.G-DEPLOYMENT-GUIDE.md)
- [01.H GW CORE contract map](01-OVERVIEW-AND-GUIDES/01.H-GW-CORE-CONTRACT-MAP.md)
- [01.I Lifecycle](01-OVERVIEW-AND-GUIDES/01.I-LIFECYCLE.md)
- [01.J Tutorial boundaries](01-OVERVIEW-AND-GUIDES/01.J-HIGH-LEVEL-TUTORIAL-BOUNDARIES.md)
- [01.K Test-network credential admission](01-OVERVIEW-AND-GUIDES/01.K-TEST-NETWORK-CREDENTIAL-ADMISSION.md)
- [01.L Secure profile enrollment](01-OVERVIEW-AND-GUIDES/01.L-SECURE-PROFILE-ENROLLMENT.md)
- [01.M Authenticated clinical author](01-OVERVIEW-AND-GUIDES/01.M-AUTHENTICATED-CLINICAL-AUTHOR.md)
- [01.N Tutorial reading order](01-OVERVIEW-AND-GUIDES/01.N-TUTORIAL-READING-ORDER.md)
- [01.O Cloud Run deployment](01-OVERVIEW-AND-GUIDES/01.O-CLOUD-RUN-DEPLOYMENT.md)
- [01.P Documentation summary (ES)](01-OVERVIEW-AND-GUIDES/01.P-DOCUMENTATION-SUMMARY-ES.md)

## 02 - API and endpoints

- [02.A API endpoints](02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md)
- [02.B Routing](02-API-AND-ENDPOINTS/02.B-ROUTING.md)
- [02.C Dataspace DID services](02-API-AND-ENDPOINTS/02.C-DATASPACE-DID-SERVICES.md)
- [02.D API CORE integration](02-API-AND-ENDPOINTS/02.D-API-CORE-INTEGRATION.md)
- [02.E OpenAPI profiles](02-API-AND-ENDPOINTS/02.E-OPENAPI-PROFILES.md)
- [02.F OpenAPI profile matrix](02-API-AND-ENDPOINTS/02.F-OPENAPI-PROFILE-MATRIX.md)

## 03 - Identity and trust

- [03.A DID and URN identifiers](03-IDENTITY-AND-TRUST/03.A-DID-URN-IDENTIFIERS.md)
- [03.B Person discovery](03-IDENTITY-AND-TRUST/03.B-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md)
- [03.C Professional consent and SMART](03-IDENTITY-AND-TRUST/03.C-PROFESSIONAL-CONSENT-SMART.md)
- [03.D Representative-controller compatibility](03-IDENTITY-AND-TRUST/03.D-REPRESENTATIVE-CONTROLLER-COMPATIBILITY.md)
- [03.E Break-glass authorization](03-IDENTITY-AND-TRUST/03.E-BREAK-GLASS-AUTHORIZATION.md)
- [03.F Clearing House OIDC](03-IDENTITY-AND-TRUST/03.F-CLEARING-HOUSE-OIDC.md)

## 04 - Deep dives

- [04.A Organization registration](04-DEEP-DIVES/04.A-ORGANIZATION-REGISTRATION.md)
- [04.B Discovery services](04-DEEP-DIVES/04.B-DISCOVERY-SERVICES.md)
- [04.C Persistence patterns](04-DEEP-DIVES/04.C-PERSISTENCE-PATTERNS.md)
- [04.D Dataspace publication attestation](04-DEEP-DIVES/04.D-DATASPACE-PUBLICATION-ATTESTATION.md)
- [04.E Fabric adapter inventory](04-DEEP-DIVES/04.E-FABRIC-ADAPTER-INVENTORY.md)
- [04.F Local topology](04-DEEP-DIVES/04.F-LOCAL-TOPOLOGY-AND-FABRIC-ENV-LOADER.md)
- [04.G Local and Fabric environment profiles](04-DEEP-DIVES/04.G-LOCAL-AND-FABRIC-ENV-PROFILES.md)
- [04.H KMS and ML-KEM responsibility matrix](04-DEEP-DIVES/04.H-KMS-MLKEM-RESPONSIBILITY-MATRIX.md)

## 05 - Use cases

- [05.A Two-host autodiscovery smoke](05-USE-CASES/05.A-ALICE-BOB-AUTODISCOVERY-SMOKE.md)
- [05.B Portal web go/no-go checklist](05-USE-CASES/05.B-PORTAL-WEB-GO-NO-GO-CHECKLIST.md)
- [05.C Client demo mode guide (ES)](05-USE-CASES/05.C-CLIENT-DEMO-MODE-GUIDE-ES.md)

## 06 - Audit and evidence

- [06.A SEDIA capability evidence matrix](06-AUDIT-AND-EVIDENCE/06.A-SEDIA-CAPABILITY-EVIDENCE-MATRIX.md)
- [06.B Organization credential audit](06-AUDIT-AND-EVIDENCE/06.B-ORGANIZATION-TEST-NETWORK-CREDENTIAL-AUDIT.md)
- [06.C Local-first release contract](06-AUDIT-AND-EVIDENCE/06.C-LOCAL-FIRST-RELEASE-CONTRACT.md)
- [06.D Testing guide](06-AUDIT-AND-EVIDENCE/06.D-TESTING-GUIDE.md)
- [06.E End-to-end testing](06-AUDIT-AND-EVIDENCE/06.E-END-TO-END-TESTING.md)
- [06.F Test contract layout](06-AUDIT-AND-EVIDENCE/06.F-TEST-CONTRACT-LAYOUT.md)
- [06.G CORE test evidence](06-AUDIT-AND-EVIDENCE/06.G-CORE-TEST-EVIDENCE.md)
- [06.H Test matrix](06-AUDIT-AND-EVIDENCE/06.H-TEST-MATRIX.md)

Generated OpenAPI artifacts remain under `docs-v1/openapi-profiles/`; generated
flow examples remain under `docs-v1/openapi-examples/`. The public HTTP route
continues to be `/docs/openapi-profiles`.
