# Project Documentation Index

- Start here for ordered reading: `docs/00-READING_ORDER.md`

This document serves as the central index for all documentation related to the Gateway Template project.

SDK-specific method documentation is canonical in `dataspace-client-sdk-node` docs and should not be duplicated here.

## Documentation Governance

- Canonical policy and cleanup rules: `docs/DOCS_GOVERNANCE.md`.

## Transitional Docs

- Top-level docs marked `Status: Transitional` are migration/bridge content.
- They must be reviewed and either moved into numbered folders or explicitly retained as cross-cutting runbooks.

## Documentation Structure

```
docs/
├── 01-OVERVIEW-AND-GUIDES/     # High-level architecture, setup, and developer guides.
├── 02-API-AND-ENDPOINTS/       # Detailed API endpoint documentation and cURL examples.
├── 03-IDENTITY-AND-TRUST/      # Concepts related to identity, DIDs, and trust policies.
├── 04-DEEP-DIVES/              # In-depth explanations of specific subsystems (Storage, Fabric, etc.).
└── 05-USE-CASES/               # End-to-end flow descriptions for specific use cases.
```

---

## File Index

## Generated Artifacts

- **Swagger/OpenAPI**: `swagger-spec.json` is generated via `npm run build:swagger` and served at `/api-docs`.
- **V2 integrators guide**: [docs-v2/09-api-integrators-guide.md](../docs-v2/09-api-integrators-guide.md) is the clean onboarding path without legacy examples/endpoints.
- **Core integration bible**: [API_CORE_INTEGRATION.md](API_CORE_INTEGRATION.md) defines the canonical SEDIA-aligned flow used by SDK live core tests.
- **Shared controller/device lifecycle note**:
  [ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md)
  is the canonical cross-repository note for legal-organization controller recovery,
  professional device replacement, and individual-controller recovery.
- **Portal API to GW CORE**: [PORTAL_API_TO_GW_CORE.md](PORTAL_API_TO_GW_CORE.md) is the canonical functional reference for portal/BFF endpoint design over GW CORE, including the separation between `employees`, `related persons`, `members`, and `consents`.
- **Communication layering source of truth**:
  - [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- **BFF/channel front-story source of truth**:
  - [101-BFF_AND_CHANNEL_MESSAGE_FLOW.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
- **IPS communication outbox source of truth**:
  - [101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- **Consent access status**: [90.E-TODO_SMART_EHR_COMPAT.md](90.E-TODO_SMART_EHR_COMPAT.md) also records the current live SMART consent-evaluation behavior, including deny precedence and permission-request lookup identifiers.
- **Tenant identifier migration note**: [90.K-TODO_TENANT_IDENTIFIER_V2.md](90.K-TODO_TENANT_IDENTIFIER_V2.md) tracks the deferred `v2.0` redesign away from `alternateName`-based hosted compatibility.
- **Current GW 101 path**: [../docs-v2/101-README.md](../docs-v2/101-README.md) is the current ordered reading path for active integrator/runtime guidance.
- **Current GW lifecycle contract**: [../docs-v2/16-deactivation-and-purge-lifecycle.md](../docs-v2/16-deactivation-and-purge-lifecycle.md) is the current lifecycle contract for integrators/auditors.
- **Current GW integrators guide**: [../docs-v2/09-api-integrators-guide.md](../docs-v2/09-api-integrators-guide.md) is the clean onboarding path without legacy route drift.
- **Bridge-only local 101 lifecycle note**: [101-01.I-LIFECYCLE.md](01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md) remains as a local bridge note.
- **Bridge-only local shared bundle editor note**: [101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md](01-OVERVIEW-AND-GUIDES/101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md) remains as a local bridge note.
- **Bridge-only local tutorial boundary note**: [101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md](01-OVERVIEW-AND-GUIDES/101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md) remains as a local bridge note.
- **GW clinical bundle reader v2**: [../docs-v2/17-clinical-bundle-readers.md](../docs-v2/17-clinical-bundle-readers.md) is the canonical integrator-facing contract for section-aware read/filter/count/pagination semantics.
- **GW deactivation/purge lifecycle**: [../docs-v2/16-deactivation-and-purge-lifecycle.md](../docs-v2/16-deactivation-and-purge-lifecycle.md) explains the disable/purge hierarchy for individual, tenant, and host, including blob deletion and discovery unpublication.
- **GW lifecycle current vs target**: [90.L-LIFECYCLE_CURRENT_VS_TARGET.md](90.L-LIFECYCLE_CURRENT_VS_TARGET.md) separates what is already implemented from the target normalized `PATCH`-based contract for SDK alignment.
- **Core test summary**: `TEST_CORE.md` explains what must be considered proved for the GW core baseline across GW + SDK repositories.
- **OpenAPI profiles**: `npm run build:openapi-profiles` derives:
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-extension.json`
  See `docs/OPENAPI_PROFILES.md`.
- **Docs QA (Flow Report)**: `artifacts/api-integrators-guide.flow-report.json` is generated via `npm run docs:flow-report` and captures the onboarding journey requests/responses.
- **Contract-check intent**: The flow report is used as a reproducible docs/examples contract check and to keep Swagger examples aligned with real responses.
- **Intentional negative controls**: Some report steps are expected to fail (for example `2.1.2 Initial Access Token Exchange (invalid code)`) to verify error handling before the valid path.
- **Flow Coverage Note**: `docs:flow-report` also validates ICA status messaging for the legal representative (`/_messages` and `/_get`). If ICA connectivity is not configured, the report records that check as informational.

## Example Data And Docs Sync

- GW canonical payload fixtures live in `src/__tests__/data/example-payloads.ts`.
- Swagger/OpenAPI examples are injected from those fixtures by `src/utils/swagger-spec.ts` and `scripts/generate-swagger-spec.mts`.
- Demo/incremental flow scripts should render from those same fixtures via `scripts/render-example-payload.mts`, applying only explicit overrides.
- Shared cross-repo examples from `gdc-common-utils-ts/examples/...` are checked by `src/__tests__/unit/examples/shared-flow-examples.test.ts`.
- Canonical lifecycle examples now live in `gdc-common-utils-ts/examples/lifecycle` and are documented in `https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-LIFECYCLE.md`.
  GW must consume those shared examples instead of introducing local lifecycle payload copies.
- Canonical markdown examples in `docs/90.A-API_INTEGRATORS_GUIDE.md` are marked with `<!-- sync-example: ... -->` and checked by `src/__tests__/unit/examples/markdown-examples.test.ts`.

Practical rule:

- Change the exported fixture first.
- Regenerate Swagger if needed with `npm run build:swagger`.
- Keep any marked markdown example byte-aligned with that fixture.
- Run:

```bash
npm test -- --runTestsByPath src/__tests__/unit/examples/markdown-examples.test.ts src/__tests__/unit/examples/shared-flow-examples.test.ts src/__tests__/unit/utils/swagger-spec.test.ts
```

## Read This Before Authoring Payloads

If you are new to GW CORE, read these before editing examples or OpenAPI descriptions:

- Communication layering 101:
  - [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- BFF/channel front-story 101:
  - [101-BFF_AND_CHANNEL_MESSAGE_FLOW.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
- Resource claims 101:
  - [101-RESOURCE_CLAIMS.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-RESOURCE_CLAIMS.md)
- IPS Communication outbox 101:
  - [101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)
- SDK node integration 101:
  - [101-SDK_INTEGRATION.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-SDK_INTEGRATION.md)

Memory aid:

- `DidComm.type` is the transport/protocol type.
- `BundleEntry.type` is a project-specific internal message kind. It is not FHIR.
- `resource.resourceType` is the FHIR-like resource type.
- `resource.meta.claims` is a project-specific non-standard claims container. It is not part of base FHIR.

## Shell Script Payload Policy

- Bash scripts may orchestrate requests, polling, and response extraction, but they must not become the source of truth for business payload contracts.
- If a `.sh` submits onboarding/auth/resource JSON that already has a canonical GW fixture, the script must render it through `scripts/render-example-payload.mts` and only apply explicit runtime overrides such as `thid`, tenant ids, subject ids, emails, or other execution-specific values.
- If a script needs synthetic demo payloads that do not belong in `example-payloads.ts`, keep those payload builders in TypeScript data/render helpers and have the `.sh` call the renderer instead of embedding large heredoc JSON bodies.
- Route smoke scripts must be labeled as smoke checks and may reuse canonical placeholder values from fixtures, but they must not invent local `dummy-*` contract fields.
- Full-flow scripts must extract step-dependent values from previous responses or required environment variables instead of fabricating them inline.

### 📂 01-OVERVIEW-AND-GUIDES
*   **[01.A-ARCHITECTURE-OVERVIEW.md](01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md)**: **(START HERE)** The main document outlining the core architectural patterns, data flows, and principles.
*   **[01.B-CREDENTIAL-ARCHITECTURE.md](01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md)**: Describes the architecture for handling digital credentials and claims.
*   **[01.C-DEVELOPER-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.C-DEVELOPER-GUIDE.md)**: Practical guide for developers on setting up and running the project.
*   **[01.D-SETUP-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.D-SETUP-GUIDE.md)**: Detailed instructions for configuring environment variables (`.env`).
*   **[01.E-IMPLEMENTING-ASYNC-ENDPOINTS.md](01-OVERVIEW-AND-GUIDES/01.E-IMPLEMENTING-ASYNC-ENDPOINTS.md)**: Guide on the async request/poll pattern used for long-running tasks.
*   **[01.F-TENANCY-AND-VAULT.md](01-OVERVIEW-AND-GUIDES/01.F-TENANCY-AND-VAULT.md)**: Explains the multi-tenancy model and the concept of a secure "Vault" for each tenant.
*   **[01.G-TESTING-PATTERNS.md](01-OVERVIEW-AND-GUIDES/01.G-TESTING-PATTERNS.md)**: Outlines the project's testing philosophy and strategies.
*   **[01.H-DEPLOYMENT-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.H-DEPLOYMENT-GUIDE.md)**: Step-by-step instructions for deploying the application to Google Cloud Run.
*   **[101-01.I-LIFECYCLE.md](01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md)**: Local lifecycle semantics for GW CORE, including `status` vs `audit`, `PATCH` target semantics, and `/_purge`.
*   **[101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md](01-OVERVIEW-AND-GUIDES/101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md)**: Current GW note on `BundleEditor`/`BundleReader` usage and which typed clinical `asX()` entry editors are really available from the installed shared package.
*   **[101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md](01-OVERVIEW-AND-GUIDES/101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md)**: Rule set for distinguishing true high-level `101` material from transport, claims, and internal plumbing examples.
*   **[docs-v2/16-deactivation-and-purge-lifecycle.md](../docs-v2/16-deactivation-and-purge-lifecycle.md)**: Auditor/integrator contract for deactivation semantics across individual, tenant, and host, including what gets unpublished and what gets physically deleted.

### 📂 02-API-AND-ENDPOINTS
*   **[02.A-API-ENDPOINTS.md](02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md)**: A summary of the primary API endpoints available.
*   **[02.B-ROUTING.md](02-API-AND-ENDPOINTS/02.B-ROUTING.md)**: Explanation of how API requests are routed to the appropriate controllers.
*   **[02.C-CURL-TESTS.md](02-API-AND-ENDPOINTS/02.C-CURL-TESTS.md)**: A collection of `curl` commands for manual API testing.
*   **[02.D-USE-CASE-CURL-EXAMPLES.md](02-API-AND-ENDPOINTS/02.D-USE-CASE-CURL-EXAMPLES.md)**: `curl` commands organized by specific use cases.
*   **[02.E-DATASPACE-DID-SERVICES.md](02-API-AND-ENDPOINTS/02.E-DATASPACE-DID-SERVICES.md)**: DSP/DCP DID `service` publication profile and conformance targets.
*   **[90.B-API_FAMILY_INTEGRATORS_GUIDE.md](90.B-API_FAMILY_INTEGRATORS_GUIDE.md)**: Family-first integration guide (operator catalog discovery + family onboarding).

### 📂 03-IDENTITY-AND-TRUST
*   **[03.A-CUSTOMER-IDENTITY-MODEL.md](03-IDENTITY-AND-TRUST/03.A-CUSTOMER-IDENTITY-MODEL.md)**: Describes the data model for representing user and organization identities.
*   **[03.B-IDENTITY-BOOTSTRAP-GUIDE.md](03-IDENTITY-AND-TRUST/03.B-IDENTITY-BOOTSTRAP-GUIDE.md)**: Guide on the process of onboarding and verifying new identities in the system.
*   **[03.C-TRUST-POLICY.md](03-IDENTITY-AND-TRUST/03.C-TRUST-POLICY.md)**: Defines the policies for trust levels and identity assurance.
*   **[03.D-DID-URN-IDENTIFIERS.md](03-IDENTITY-AND-TRUST/03.D-DID-URN-IDENTIFIERS.md)**: Details on the format and use of Decentralized Identifiers (DIDs) and URNs.
*   **[03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md](03-IDENTITY-AND-TRUST/03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md)**: Architecture for the user discovery and consent-driven data sharing mechanism.
*   **[03.F-ENTITY-KEY-MANAGEMENT-LIFECYCLE.md](03-IDENTITY-AND-TRUST/03.F-ENTITY-KEY-MANAGEMENT-LIFECYCLE.md)**: Explains how cryptographic keys for entities are managed throughout their lifecycle.
*   **[03.G-LEGACY-AND-MANAGED-KEYS.md](03-IDENTITY-AND-TRUST/03.G-LEGACY-AND-MANAGED-KEYS.md)**: Discusses strategies for handling both externally managed and system-managed keys.
*   **[03.H-ICA-CERTIFICATE-ISSUANCE.md](03-IDENTITY-AND-TRUST/03.H-ICA-CERTIFICATE-ISSUANCE.md)**: Documents the split between Fabric operational enrollment and dataspace ICA Host VC issuance, plus the boundary between host certificate bootstrap and host autodiscovery.
*   **[03.I-HOSTING-OPERATOR-BOOTSTRAP-AUDIT.md](03-IDENTITY-AND-TRUST/03.I-HOSTING-OPERATOR-BOOTSTRAP-AUDIT.md)**: Audit reference for the hosting-operator bootstrap boundary, including `env -> vault -> Fabric bootstrap` resolution order and the separation between hosting validation, operational enrollment, and Host VC issuance.
*   **[03.J-PROFESSIONAL-CONSENT-SMART.md](03-IDENTITY-AND-TRUST/03.J-PROFESSIONAL-CONSENT-SMART.md)**: Canonical professional DID reuse across employee/profile identity, Consent, VP and SMART, including endpoint audience resolution and hash-boundary semantics.

### 📂 04-DEEP-DIVES
*   **[04.A-VC-ARCHITECTURE-DEEP-DIVE.md](04-DEEP-DIVES/04.A-VC-ARCHITECTURE-DEEP-DIVE.md)**: A deep dive into the Verifiable Credentials architecture.
*   **[04.B-FABRIC-IMPLEMENTATION-PLAN.md](04-DEEP-DIVES/04.B-FABRIC-IMPLEMENTATION-PLAN.md)**: Technical plan for integrating with Hyperledger Fabric.
*   **[04.C-ORGANIZATION-REGISTRATION.md](04-DEEP-DIVES/04.C-ORGANIZATION-REGISTRATION.md)**: Detailed flow for the registration of new tenant organizations.
*   **[04.D-DISCOVERY-SERVICES.md](04-DEEP-DIVES/04.D-DISCOVERY-SERVICES.md)**: In-depth look at the services responsible for discovering entities and data.
*   **[04.E-NEW-STORAGE-ARCHITECTURE.md](04-DEEP-DIVES/04.E-NEW-STORAGE-ARCHITECTURE.md)**: Plan for refactoring the storage layer to a unified repository pattern.
*   **[04.F-PERSISTENCE-PATTERNS.md](04-DEEP-DIVES/04.F-PERSISTENCE-PATTERNS.md)**: Describes patterns for data persistence and storage.
*   **[04.G-CONVERSATIONAL-AI-ANONYMIZATION-PIPELINE.md](04-DEEP-DIVES/04.G-CONVERSATIONAL-AI-ANONYMIZATION-PIPELINE.md)**: Design for conversation storage, anonymization, and derivation of Observations with ledger-safe tags.
*   **[04.H-DATASPACE-PUBLICATION-ATTESTATION.md](04-DEEP-DIVES/04.H-DATASPACE-PUBLICATION-ATTESTATION.md)**: Clarifies what is published by link vs anchored on-ledger (hashes/tags), and how attestation/provenance fits.
*   **[04.I-FABRIC-MULTICLOUD-BLUEPRINT.md](04-DEEP-DIVES/04.I-FABRIC-MULTICLOUD-BLUEPRINT.md)**: Multi-cloud Fabric deployment plan and channel governance.
*   **[04.J-HOST-OPERATORS-REGISTRY-AND-SECTOR-CATALOGS.md](04-DEEP-DIVES/04.J-HOST-OPERATORS-REGISTRY-AND-SECTOR-CATALOGS.md)**: Separates host operator discovery from tenant sector catalog publication and distinguishes DSP standard paths from GW CORE local catalog bindings.
*   **[04.K-FABRIC-ADAPTER-INVENTORY-AND-DUAL-NETWORK-TARGET.md](04-DEEP-DIVES/04.K-FABRIC-ADAPTER-INVENTORY-AND-DUAL-NETWORK-TARGET.md)**: Inventories the existing Fabric adapter/codebase and defines the additive dual-network target with Pontus-X.

### 📂 05-USE-CASES
*   **[05.A-ALICE-BOB-AUTODISCOVERY-SMOKE.md](05-USE-CASES/05.A-ALICE-BOB-AUTODISCOVERY-SMOKE.md)**: Local two-host smoke for host catalogs and normalized provider discovery.
*   Core use cases only. Legacy/extension use-case docs were moved to transitional `90.*` files.

### 📂 Transitional Scenarios (Not Core Baseline)
*   **[90.L-LIFECYCLE_CURRENT_VS_TARGET.md](90.L-LIFECYCLE_CURRENT_VS_TARGET.md)**: Transitional mapping between current GW lifecycle endpoints and the target normalized contract for SDK/shared-package alignment.
*   **[90.N-APPOINTMENT_NOTIFICATION_FLOW_LEGACY.md](90.N-APPOINTMENT_NOTIFICATION_FLOW_LEGACY.md)**: Legacy appointment-notification narrative (not part of current core baseline).
*   **[90.O-END_TO_END_LEGACY_FLOW.md](90.O-END_TO_END_LEGACY_FLOW.md)**: Legacy end-to-end flow reference (transitional).
*   **[90.P-HOST_OPERATORS_REGISTRY_BACKLOG.md](90.P-HOST_OPERATORS_REGISTRY_BACKLOG.md)**: Concrete implementation backlog for host provider verification, host DCAT discovery, tenant sector catalog separation, and optional sector-profile work.
