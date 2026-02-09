# Project Documentation Index

This document serves as the central index for all documentation related to the Gateway Template project.

## Documentation Structure

```
docs/
├── 01-OVERVIEW-AND-GUIDES/     # High-level architecture, setup, and developer guides.
├── 02-API-AND-ENDPOINTS/       # Detailed API endpoint documentation and cURL examples.
├── 03-IDENTITY-AND-TRUST/      # Concepts related to identity, DIDs, and trust policies.
├── 04-DEEP-DIVES/              # In-depth explanations of specific subsystems (Storage, Fabric, etc.).
└── scenarios/                  # End-to-end flow descriptions for specific use cases.
```

---

## File Index

## Generated Artifacts

- **Swagger/OpenAPI**: `swagger-spec.json` is generated via `npm run build:swagger` and served at `/api-docs`.
- **Docs QA (Flow Report)**: `artifacts/api-integrators-guide.flow-report.json` is generated via `npm run docs:flow-report` and captures the onboarding journey requests/responses.
- **Flow Coverage Note**: `docs:flow-report` also validates ICA status messaging for the legal representative (`/_messages` and `/_get`). If ICA connectivity is not configured, the report records that check as informational.

### 📂 01-OVERVIEW-AND-GUIDES
*   **[01.A-ARCHITECTURE-OVERVIEW.md](01-OVERVIEW-AND-GUIDES/01.A-ARCHITECTURE-OVERVIEW.md)**: **(START HERE)** The main document outlining the core architectural patterns, data flows, and principles.
*   **[01.B-CREDENTIAL-ARCHITECTURE.md](01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md)**: Describes the architecture for handling digital credentials and claims.
*   **[01.C-DEVELOPER-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.C-DEVELOPER-GUIDE.md)**: Practical guide for developers on setting up and running the project.
*   **[01.D-SETUP-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.D-SETUP-GUIDE.md)**: Detailed instructions for configuring environment variables (`.env`).
*   **[01.E-IMPLEMENTING-ASYNC-ENDPOINTS.md](01-OVERVIEW-AND-GUIDES/01.E-IMPLEMENTING-ASYNC-ENDPOINTS.md)**: Guide on the async request/poll pattern used for long-running tasks.
*   **[01.F-TENANCY-AND-VAULT.md](01-OVERVIEW-AND-GUIDES/01.F-TENANCY-AND-VAULT.md)**: Explains the multi-tenancy model and the concept of a secure "Vault" for each tenant.
*   **[01.G-TESTING-PATTERNS.md](01-OVERVIEW-AND-GUIDES/01.G-TESTING-PATTERNS.md)**: Outlines the project's testing philosophy and strategies.
*   **[01.H-DEPLOYMENT-GUIDE.md](01-OVERVIEW-AND-GUIDES/01.H-DEPLOYMENT-GUIDE.md)**: Step-by-step instructions for deploying the application to Google Cloud Run.

### 📂 02-API-AND-ENDPOINTS
*   **[02.A-API-ENDPOINTS.md](02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md)**: A summary of the primary API endpoints available.
*   **[02.B-ROUTING.md](02-API-AND-ENDPOINTS/02.B-ROUTING.md)**: Explanation of how API requests are routed to the appropriate controllers.
*   **[02.C-CURL-TESTS.md](02-API-AND-ENDPOINTS/02.C-CURL-TESTS.md)**: A collection of `curl` commands for manual API testing.
*   **[02.D-USE-CASE-CURL-EXAMPLES.md](02-API-AND-ENDPOINTS/02.D-USE-CASE-CURL-EXAMPLES.md)**: `curl` commands organized by specific use cases.
*   **[02.E-DATASPACE-DID-SERVICES.md](02-API-AND-ENDPOINTS/02.E-DATASPACE-DID-SERVICES.md)**: DSP/DCP DID `service` publication profile and conformance targets.

### 📂 03-IDENTITY-AND-TRUST
*   **[03.A-CUSTOMER-IDENTITY-MODEL.md](03-IDENTITY-AND-TRUST/03.A-CUSTOMER-IDENTITY-MODEL.md)**: Describes the data model for representing user and organization identities.
*   **[03.B-IDENTITY-BOOTSTRAP-GUIDE.md](03-IDENTITY-AND-TRUST/03.B-IDENTITY-BOOTSTRAP-GUIDE.md)**: Guide on the process of onboarding and verifying new identities in the system.
*   **[03.C-TRUST-POLICY.md](03-IDENTITY-AND-TRUST/03.C-TRUST-POLICY.md)**: Defines the policies for trust levels and identity assurance.
*   **[03.D-DID-URN-IDENTIFIERS.md](03-IDENTITY-AND-TRUST/03.D-DID-URN-IDENTIFIERS.md)**: Details on the format and use of Decentralized Identifiers (DIDs) and URNs.
*   **[03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md](03-IDENTITY-AND-TRUST/03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md)**: Architecture for the user discovery and consent-driven data sharing mechanism.
*   **[03.F-ENTITY-KEY-MANAGEMENT-LIFECYCLE.md](03-IDENTITY-AND-TRUST/03.F-ENTITY-KEY-MANAGEMENT-LIFECYCLE.md)**: Explains how cryptographic keys for entities are managed throughout their lifecycle.
*   **[03.G-LEGACY-AND-MANAGED-KEYS.md](03-IDENTITY-AND-TRUST/03.G-LEGACY-AND-MANAGED-KEYS.md)**: Discusses strategies for handling both externally managed and system-managed keys.

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

### 📂 scenarios
*   **[appointment-notification-flow.md](scenarios/appointment-notification-flow.md)**: E2E description of an appointment notification use case.
*   **[end-to-end-legacy-flow.md](scenarios/end-to-end-legacy-flow.md)**: E2E description of a data flow involving legacy systems.
