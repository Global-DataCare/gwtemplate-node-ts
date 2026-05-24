## 1.5.1 - 2026-05-23

### Changed
- Aligned GW CORE activation, DID publication, discovery, and shared examples with the new shared package minor line.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.5.0`.
- Clarified canonical `_activate` semantics around `vp_token`, `controller.*`, and deprecated legacy credential side-fields.

### Testing
- Targeted activation/discovery/shared-example suites pass against the packaged shared dependency.

## 1.3.14 - 2026-05-21

### Tests
- Added TDD coverage for the core lifecycle split:
  - `Employee/_batch` create, deactivate, and not-found handling
  - `MedicationStatement/_batch` not-found route semantics
  - `CommunicationManager` tenant-resolution not-found handling
- Kept coverage focused on canonical core flow resources without introducing extension behavior.

## 1.3.13 - 2026-05-20

### Added
- Local process helpers:
  - `npm run local:close` (port `3000`)
  - `npm run docker:close` (port `8000`)
- Canonical occupation claim helper:
  - `src/utils/occupation.ts`

### Changed
- Demo tenant bootstrap now uses canonical representative-role claims:
  - `org.schema.Person.hasOccupation.identifier.additionalType = "v3-RoleCode"`
  - `org.schema.Person.hasOccupation.identifier.value = "RESPRSN"`
- Role-code parsing migrated to canonical occupation helper in:
  - `HostingManager`
  - `EmployeeManager`
  - `FamilyManager`

### Tests
- `npm run type-check`: pass.
- `npm run test:e2e`: pass (no failing suites; specs remain conditionally skipped when live E2E credentials are not configured).

## 1.3.12 - 2026-05-18

### Added
- `CommunicationManager` now persists a subject-scoped auditable communication channel record as `CommMsgExtended` under `individual_communications_*` sections.

### Changed
- GW now treats `CommMsgExtended` as the atomic confidential-channel event and `FHIR Communication` as its interoperable health projection.
- `DocumentReference` extraction from `Communication.payload.contentAttachment` is now an explicit one-attachment-per-record atomic projection for retrieval and secure-storage indexing.
- Subject-scoped communication channel records now expose canonical `Communication.content-reference` values pointing to referenced business resources and atomized `DocumentReference/<id>` records.

## 1.3.11 - 2026-05-18

### Changed
- Updated dependency to `gdc-common-utils-ts@^1.4.20`.
- Refreshed generated OpenAPI profile artifacts after the canonical representative-role alignment release.

## 1.3.10 - 2026-05-18

### Changed
- Adopted `gdc-common-utils-ts@^1.4.18` shared role normalization for activation representative validation.
- Canonical legal-representative occupation format is now `credentialSubject.hasOccupation.identifier.value = "RESPRSN"` (legacy tokens still accepted by normalizer).

## 1.3.9 - 2026-05-18

### Changed
- Activation representative validation now consumes shared `gdc-common-utils-ts` policy helpers instead of local duplicated parsing logic.
- Core integration doc now states canonical member DID composition: owner DID prefix + `:member:<member-id>:<role>`.

## 1.3.8 - 2026-05-18

### Changed
- Enforced legal-representative VC security linkage in `_activate` trust validation:
  - `credentialSubject.memberOf.taxID` must match organization credential tax ID.
  - `credentialSubject.hasOccupation` must include `RESPRSN` (Responsible Party).
  - `credentialSubject.hasCredential.material` is now required.
- Core API examples are now VP-JSON-first for activation (`body.data[].vp`) to keep proofs readable/auditable; tests can derive `vp_token` JWT from that canonical VP object.

## 1.3.7 - 2026-05-06

### Changed
- Documented `_activate` trust validation contract aligned with ICA credentials:
  - representative VC must be trusted from ICA signature chain,
  - `org.schema.Person.memberOf.taxID` must match the organization tenant canonical identifier (`Organization.identifier.value`),
  - `org.schema.Person.hasCredential.material` is the source of representative signing-key binding for VP signature checks.
- Clarified authentication semantics for onboarding:
  - `vp_token` is a proof payload inside the activation message body,
  - HTTP `Authorization: Bearer` remains a transport/auth header concern and is not the VP itself.

## 1.3.6 - 2026-05-05

### Added
- Added strict license-gating mode for employee creation with `MANDATORY_LICENSE_CREATING_MEMBERS=true`.
- In strict mode, `Employee/_batch` now processes entries sequentially and returns per-entry `409 + OperationOutcome` when seats are exhausted, while keeping prior successful entries.

### Changed
- Kept backward compatibility when strict mode is disabled: legacy `Employee-license-offer-v1.0` behavior remains unchanged.
- Updated controller/practitioner step-by-step docs and endpoint/path clarifications for onboarding vs runtime identity/token flows.

### Tests
- Added unit coverage for partial batch behavior under mandatory license mode (success prefix, failure suffix).

## 1.3.5 - 2026-05-04

### Changed
- Activation trust now accepts organization credential resolved from `vp_token` (Verifiable Presentation) without requiring representative credential as mandatory input.
- Hosting activation parsing now resolves `OrganizationCredential` / `LegalOrganizationCredential` (and optional representative credential) from `vp_token.verifiableCredential[]`.
- Host onboarding/integration contract aligned to `/host/...` routes with `auth` security model for current gateway flows (OIDC pre-DCR and SMART post-DCR).
- Documentation alignment clarified for cross-service namespace consistency:
  - Gateway: `/host/...`
  - ICA: `/ica/...`
  - DataConv: `/publisher/...`

### Tests
- Added unit coverage for VP-based organization credential extraction in hosting activation flow.
- Updated activation trust adapter tests to validate activation without representative credential.

## 1.3.4 - 2026-04-30

### Changed

- Included sector/business routing consistency, docs updates, and alignment utilities/tests from upstream evolution scope.

### Fixed

- 2026-04-11 12:10: Fixed Stripe webhook endpoint mounting so the public route is `/webhooks/stripe` (previously double-prefixed as `/webhooks/webhooks/stripe`), and added integration coverage for route resolution.

## [1.3.0] - 2026-04-11

### Added

- 2026-04-11: Added PostgreSQL-backed vault repository support with schema bootstrap, runtime wiring for `DB_PROVIDER=postgres`, and integration coverage using `pg-mem` for secure indexed confidential storage queries.
- 2026-04-11: Added `.env.local.postgres` overrides and `npm run api:local-postgres` for running the API locally against PostgreSQL without duplicating the full local environment file.
- 2026-04-11: Added `docker-compose.postgres.yml` plus local helper scripts to start, stop, and inspect a dedicated PostgreSQL container for the new vault provider.
- 2026-04-11: Added `db:local-postgres:reset`; the PostgreSQL vault schema is auto-created by the API at startup, so no manual init SQL is required for this initial adapter rollout.

## [1.2.0] - 2026-03-14

### Added

- OneHealth sector model based on `MAINSECTOR` + `SUBSECTORSALLOWED`, with synthetic sectors for `animal-*` and `health-*`.
- OneHealth FHIR and research routing for care, index, tech, and digital twin ingestion use cases.
- Research digital twin ingestion endpoints for `Composition/_batch` in `digitaltwin/org.hl7.fhir.api` and `digitaltwin/org.hl7.fhir.r4`.
- Host onboarding contract for `Organization/_activate` and `_activate-response` in API docs, swagger, and service discovery.
- Error helpers to keep early 4xx/5xx responses compatible with DIDComm/FHIR clients.

### Changed

- Host and tenant service generation now derives capabilities from sector semantics instead of a fixed legacy FHIR sector list.
- OneHealth docs and examples now cover animal and human health channels, research ingestion, and the ICA-first activation target flow.
- OIDC/SMART discovery and legacy signing defaults remain aligned on ES384 / P-384 for compatibility with the current backend.

### Fixed

- FHIR ingestion and polling behavior for legacy raw FHIR mode now stays asynchronous while preserving raw FHIR poll responses.
- Request validation, swagger generation, and manager coverage were extended for the new OneHealth routes and sectors.

### Known limitations

- `Organization/_activate` is published as an exposed contract, but worker-side activation is still a placeholder and returns `NotSupported`.

### Added

- Secure Key Resolution for Standard Crypto Flow: When a protected request arrives without an embedded `jwk` in the JWE and JWS protected header, KmsService now follows a secure query pattern:

  It derives the tenant's vaultId from the issuer's (iss) DID (e.g., an employee or customer DID).
  
  It uses its internal HMAC capabilities to protect the query parameters (i.e., the key identifier `kid` as attribute name).
  
  It queries the VaultRepository using these protected parameters to find the corresponding encrypted document.
  
  It decrypts the employee/customer configuration document just-in-time to retrieve the public key required (jwk) to encrypt the future response.

-   **New Person Discovery Feature:** Implemented a new asynchronous `_discovery` action to find a Person's `did:web` using private identifiers.
    -   The new endpoint is `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/test-network/org.schema/Person/_discovery`.
    -   The backend handles URN construction, hashing, and dynamic routing to the appropriate blockchain channel (`<sector>-eu` or `<sector>-global`) and smart contract (`discovery-person`) based on "convention over configuration".
    -   Introduced `NetworkActionsController` and a dedicated `networkRouter` to manage this new API section.
    -   Added new utility modules to support the discovery logic: `identifier-parser.ts`, `jurisdiction.ts`, and identifier-channel helpers.
-   **Contextualized Claims Normalization:** Added claim normalization + deterministic ordering for contextualized schema.org claims (see `src/utils/claims.ts`) to support future canonical hashing.
-   **Family Onboarding (Offer/Order):** Added `FamilyManager` and data fixtures to support family (household) registration with the same Offer/Order pattern used for tenant onboarding.
-   **Sandbox-Safe Integration Test Harness:** Added `invokeExpress` helper to run integration tests without binding a TCP port (required in sandboxed environments).
-   **SMART Token Issuance (Async):** Added `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token` job flow with polling via `.../identity/openid/smart/_batch-response`, including consent-rule matching by actor (jurisdiction URN / did:web / email), role, purpose, and requested LOINC sections.
-   **Consent Rule Fixtures:** Added `src/__tests__/data/consent-rules.data.ts` and unit/integration coverage for consent-based SMART token gating.

### Changed

-   **Refactored `CustomerManager`:** The manager now handles the new `_discovery` action alongside the existing `_batch` action.
    -   The discovery logic is optimized to group multiple identifier hashes (e.g., from `NNES` and alternate identifiers for the same person) and query the blockchain in a single, efficient batch call per channel target.
    -   The smart contract is expected to implement a "first match wins" optimization for these batch queries.
-   **Updated `IBlockchainAdapter`:** The interface was changed from `discoverDidByHash` to the batch-aware `discoverDidsByHashes` to support the performance optimization.
-   **Updated Service Definitions (`services.ts`):**
-   **DID Service ID Convention (SDK parity):** DID Document service IDs now follow `#<section>:<format>:<resourceType>:<action>` via `generateServiceId()` (and request validation supports both config selectors and DID fragments).
-   **Backend Crypto Adapter (Node):** `CryptographyService` is now instantiated with a Node `ICryptoHelper` adapter (random UUIDs/bytes + SHA/SHA3 digests) to match the SDK’s platform-adapter approach.
-   **Customer → Individual:** Renamed the worker registry key from `customerManager` to `individualManager` and renamed the unit test file to `IndividualManager.test.ts`.
-   **Secure API Routing:** Path params are now authoritative when building the async `jobRequest` (prevents decoded payload fields from overriding `tenantId/sector/section/resourceType`).
-   **OIDC Service Definitions:** Split OIDC service templates so `Device/_dcr` and `smart/token` don’t cross-combine (no accidental `Smart/_dcr` or `Device/token` in DID service multiplexing).
-   **Test Environment Isolation:** `src/server.ts` no longer loads `.env.local` (or initializes Firebase) under Jest, and Jest now sets safe default host env vars for `startServer()`-based integration tests.

### Fixed

-   **Architectural Flaw in Asynchronous Job Processing:** Corrected a major flaw in how the system handles plaintext (`application/json`) asynchronous requests. The new, secure flow is as follows:
    -   **Problem:** Plaintext requests were generating plaintext responses, which were stored directly in the response store, breaking the polling handler which expects all artifacts to be encrypted JWEs.
    -   **Solution:** All job results are now **always** stored as encrypted JWEs. For plaintext requests where the client does not provide a public key, the system uses an **"encrypt-to-self"** pattern: the `Worker` encrypts the response using the public key of the tenant processing the job (or for the new tenant in the case of onboarding).
    -   The `pollingHandler` is now responsible for inspecting the original request's `Content-Type`. If it was a JSON-based type, the handler **decrypts** the stored JWE just-in-time before sending the final plaintext JSON payload back to the client. This ensures clients that send JSON receive JSON, abstracting the internal security measures.

-   **Corrected Onboarding Tests:** Fixed all failing unit tests for `CustomerManager` by aligning the test data's job action with the manager's expectation.
-   **Resolved `tsc` Compilation Errors**
-   **BYOK End-to-End Flow:** Fixed `byok-dcr` integration test by making the flow complete Offer→Order and making polling robust.
-   **CORS + In-Memory Express Invocation:** Fixed crashes in integration tests caused by `cors/vary` expecting Node `ServerResponse` header APIs.
-   **Hosting Offer/Order:** Fixed Offer identifier handling, ensured tenant config retains required claims, and persisted an indexable admin employee record so secure key resolution can find `kid/skid`.
-   **KMS Key Metadata:** Ensured managed JWKs are marked with `use: 'sig'|'enc'` so downstream key selection works reliably.
-   **DCR Example Data:** Updated test fixtures so the DCR `code` is a valid UUID, aligning with `DeviceRegistrationManager` activation-code validation.

### Internal

-   **Unit Tests:** Added a comprehensive suite of unit tests for the new batch discovery logic in `CustomerManager.test.ts`.
-   **End-to-End Test:** Added a new test case (`Part 8`) to the main integration test suite (`end-to-end-flow.test.ts`). This test verifies the full, asynchronous submit-and-poll flow for the `_discovery` endpoint using a real, encrypted JWE payload.
-   **Documentation:** Created a new, detailed architecture document for the discovery feature at `docs/03-IDENTITY-AND-TRUST/03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md`, which includes a Mermaid sequence diagram illustrating the entire flow, and ``.
-   **Code Cleanup:** Removed the obsolete `CustomerDiscoveryManager` and its test file, as its logic was consolidated into `CustomerManager`. Disabled verbose cryptographic logs to improve test readability.
-   **Integration Suite Hardening:** Updated Jest config and integration tests to avoid sandbox-incompatible e2e/firestore runs and to use in-memory Express invocation.
-   **Docs:** Updated `docs/API_INTEGRATORS_GUIDE.md` with contextualized claims normalization rules and license gating notes.

## [Unreleased]

### Added
- Integration coverage for `Bundle/_search` DocumentReference retrieval by canonical hash claim:
  - `DocumentReference?subject=<did>&contenthash=<cid>`
  - response contract validated via `DocumentReference-search-response-v1.0`.

### Changed
- Communication attachment projection now separates:
  - `DocumentReference.identifier` as logical UUID/URN identifier,
  - `DocumentReference.contenthash` as content hash/CID for retrieval/integrity.
- Bundle search parser now prioritizes `contenthash` query/filter names and keeps legacy hash aliases for temporary compatibility.
- API integrator guide updated with canonical `DocumentReference.contenthash` field contract.

### Added
- **End-to-End Test for Person Onboarding**: A comprehensive E2E test (`Part 3`) now verifies the entire asynchronous flow for creating a `Person` resource, including job submission (`202 Accepted`), secure polling with `POST` (`200 OK`), and final response validation (`201 Created`).
- **TDD Roadmap for Future Features**: Added tests (`Part 4` for `Composition` and `Part 5` for `Communication`) in the E2E flow. These tests act as an executable specification and clear roadmap for the next development steps.
- **`CustomerManager` Integration**: Fully integrated the `CustomerManager` into the server initialization, connecting it to the `Worker` via the `ManagerRegistry`.

### Changed
- **Corrected Tenant Service Configuration**: Updated `utils/services.ts` to correctly define the service endpoint for the `individual` section (previously `index`), enabling the `Person`, `Composition`, `Communication`, and `Subscription` resource types.
- **Refactored `CredentialManager` Dependencies**: The `CredentialManager` constructor now correctly receives only the `hostExternalDomain` string instead of the entire `IServerConfig` object, adhering to dependency injection best practices.
- **Standardized Manager Logic**: Refactored `CustomerManager` to correctly derive the `vaultId` from the `job.sector` and `job.tenantId` properties, following the established architectural pattern where managers (not the router) are responsible for this logic.

### Fixed
- **Critical Bug in Job Context**: Fixed a critical bug where `CustomerManager` was incorrectly interpreting `job.tenantId` as the `vaultId`, leading to "Tenant not found" errors. The manager now correctly reconstructs the `vaultId`..
- **Module Interoperability Issues**: Standardized the import and usage of CommonJS modules like `express` across the application (`server.ts`, `discovery.ts`) to use the `import * as name` and `name.default()` pattern, resolving persistent compilation and runtime errors.
- **E2E Test Polling Logic**: Corrected the E2E test to use the secure `POST` method with the `thid` in the `body` for polling, aligning with the server's implementation.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2025-10-15-0126]

### SECURITY

-   **Formalized the Inbound Request Security Model:** A clear, two-phase security model has been implemented and documented, strictly separating **Authentication** from **Authorization**.
    -   **Phase 1 (Authentication):** The API Controller (`api.ts`) is now solely responsible for authenticating requests. It uses a `try...catch` block to call the `KmsService`. If signature verification fails, the KMS throws an error, and the API immediately returns a **`401 Unauthorized`**.
    -   **Phase 2 (Authorization):** Business-level authorization (e.g., checking if a signer is a permitted "controller" via `assertionMethod` for a specific action like Fabric onboarding) is now the responsibility of the asynchronous **Worker** and its respective **Manager**. The API controller no longer handles this logic.
-   Added a critical security integration test (`should return 401 Unauthorized...`) to ensure the API correctly handles cryptographic signature failures from the KMS.

### CHANGED

-   **Improved Job Name Uniqueness:** The `createJobName` function now uses the unique `vaultId` (e.g., "health-care_acme") to generate the job name, preventing potential collisions between tenants with the same `alternateName` in different sectors.
-   **Clarified Naming Convention:** Refactored `createJobName` and `parseJobName` in `src/utils/naming.ts` to use the parameter `jobContextId` instead of the ambiguous `tenantId`, and updated documentation to clarify that this ID must be the `vaultId`.
-   **Refined Test Suite Logic:** Integration tests for API endpoints (`employeeApi.test.ts`, `networkEnrollmentApi.test.ts`) have been simplified to follow the DRY principle. They now focus on verifying their specific endpoint integration, while the detailed mechanics of job creation are exhaustively tested in `pingApi.test.ts`.

### FIXED

-   **Fixed the `tenantId` in the `JobRequest` to preserve the original path parameter:** A critical bug was fixed in the API controller where the `jobRequest.tenantId` (which should be the tenant's `alternateName` from the URL) was being incorrectly overwritten with the internal `vaultId`. The `JobRequest` now correctly preserves the raw path parameters for the worker to process.
-   **Corrected Job Name Creation:** Fixed a bug in `createJobName` that was incorrectly stripping the leading underscore from actions (e.g., `_batch` became `batch`).
-   **Repaired All Integration Tests:** Aligned `pingApi.test.ts`, `employeeApi.test.ts`, and the original `networkEnrollmentApi.test.ts` with the corrected architecture, ensuring the entire test suite passes.

### Added

-   **Enhanced Architectural Documentation:** Updated `ARCHITECTURE-OVERVIEW.md` and `DEVELOPER_GUIDE.md` to reflect the new security model, the separation of AuthN/AuthZ, and the correct data flow from the API controller to the worker.

## [20251014-1710]

### Added
- **TDD-Driven URL Utilities**:
  - Created a new unit-tested `getBaseUrlFromDidWeb` utility in `did.ts` to correctly parse `did:web` identifiers, including those with percent-encoded ports (e.g., `localhost%3A3000`).
  - Implemented a new, fully unit-tested `getTenantDomainUrl` method in `TenantsCacheManager` using a TDD approach. This method provides the canonical service URL for a tenant, prioritizing their external domain and falling back to the gateway's hosted URL.

### Changed
- **Major Architectural Refactoring of Discovery Service**:
  - The system now correctly derives a tenant's hosted URL from the host's own `did:web` identifier, making the `TenantsCacheManager` self-reliant and architecturally sound.
  - The `discovery.ts` router and its `resolveTenant` middleware were completely refactored to remove dependencies on internal configuration objects, improving encapsulation and security. The router now correctly handles the `/:tenantId/cds.../.well-known/did.json` path.
- **`TenantsCacheManager` Naming**: Renamed `getTenantUrn` to the more descriptive `getTenantIdentifierUrn` across the entire codebase for clarity.

### Fixed
- **Critical Security Fix in Ping Handler**:
  - Refactored the `ping.handler.ts` to derive the JWT `iss` (issuer) claim from the request's `Host` header.
  - This corrects a major architectural flaw and ensures that the identity in a discovery response matches the domain the client is interacting with, adhering to `did:web` security principles.
- **Test Suite Failures**:
  - Correctly implemented the updated `IKmsService` interface in `DemoKmsService`, `KmsService`, and `kms.mock.ts`.
  - Added the `type` property to the `IndexedAttribute` model to preserve data semantics during HMAC protection.
  - Fixed dependency injection in `PingManager.test.ts`.
  - Replaced the obsolete `DidDocumentBuilder.test.ts` with `did-document.test.ts` and created a new, correct integration test for the Well-Known API endpoint (`wellKnownApi.test.ts`).



### Added
- **Batch Processing & Identifier Generation in `CustomerManager`**:
  - Re-architected `CustomerManager` to correctly process `_batch` requests by handling each entry as a discrete customer creation.
  - Implemented logic to automatically generate a new `urn:uuid:...` identifier if an entry is submitted without one (User Story 1: Self-Onboarding).
  - Implemented logic to aggregate claims from multiple batch entries that share the same anchor `identifier` into a single, unified customer record (User Story 2: Professional Onboarding).
- **Canonical Customer Public ID**:
  - `CustomerManager` now enforces the creation of a canonical public identifier for customers based on the pattern: `urn:...:individual:multibase:z<base58btc(uuid)>`.
  - Added a new `uuidToBytes` utility to correctly convert UUID strings into 16-byte arrays for encoding.

### Fixed
- **`uuid` Library Mocking**: Corrected the Jest mock for the `uuid` library in `CustomerManager.test.ts` to include the `validate` function.
- **Corrected `vc.id` Generation**:
  - Refactored the `vc-id` utility to correctly implement the "Versioned Credential ID" pattern: `z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))`.
  - Removed all problematic `multiformats` dependencies and replaced them with a self-contained `base-x` implementation to resolve persistent module resolution failures.
- **Enforced `credentialSubject.identifier` Usage**:
  - Updated `CredentialManager` to use `credentialSubject.identifier` for the subject's stable URN, adhering to the documented "Golden Rule" and W3C best practices.
  - Corrected the `CredentialManager.test.ts` suite to validate the `identifier` field, not the `id` field, in the `credentialSubject`.

### Added
- **Created Structured Documentation Hub**:
  - Consolidated all architectural and guide markdown files into a new, organized `/docs` directory with a numbered, thematic structure.
  - Created a new `docs/01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md` to formally document the mandatory patterns for VC ID generation, subject identification, and issuance formats.


### Changed
- **Re-architected `CredentialManager`:**
  - Refactored `CredentialManager` to be a generic, low-level credential issuance engine with a core `createAndSignVc` private method. It is no longer a public-facing manager that handles jobs directly, but an internal service invoked by other managers.
  - Aligned the manager's architecture with modern project patterns, ensuring it throws `ManagerError` on failure, to be caught by the calling business-logic manager.
- **Unified Indexed Attribute Types:**
  - Corrected the type signature for `IKmsService.protectAttributesNameAndValue` to return `Promise<IndexedAttribute[]>` instead of `ParamAttribute[]`, reflecting the transformation that occurs.
  - Refactored `CustomerManager` and `CredentialManager` to use the correct `ParameterData` type when preparing indexed attributes, eliminating type mismatches and manual mapping.

### Fixed
- **Fixed Critical Security Vulnerability:** Removed logic in `CredentialManager` that incorrectly decrypted a tenant's entire sensitive `EntityConfig`, preventing a major data exposure vulnerability. The manager now only works with pre-validated public claims.
- **Fixed `CredentialManager.test.ts`:**
  - Completely rewrote the test suite to align with the new, secure architecture.
  - Added test cases for `issueOrganizationSelfDescription` (signed by host) and `issueEmployeeCredential` (signed by tenant).
  - Added tests for secure storage (`storeCredential`) and retrieval (`searchCredential`), including mocking the repository's `query` method.
  - Corrected all `tsc` and `jest` errors.

### Added
- **Added `parseValidityPeriod` Utility:** Created and tested a new time utility at `src/utils/time.ts` to parse human-readable period strings (e.g., "1y", "5m") into `Date` objects, ensuring all operations are UTC-safe.


### Added

-   **Sovereign Identity Architecture:** Introduced a new identity model based on semantic URNs and Verifiable Credentials (VCs) to align with SSI, Gaia-X, and IDS principles.
-   **`ARCHITECTURE_PATTERNS.md`:** Created a canonical document for architectural patterns, including a detailed section on the new Sovereign Identity model.
-   **`TenantsCacheManager.getTenantUrn()`:** Added a new, efficient method to resolve a tenant's internal ID to their sovereign URN.
-   **`TenantsCacheManager.getDidServiceConfig()`:** Added a new, efficient method to retrieve only the DID service configuration for a tenant.

### Changed

-   **`EmployeeManager`:** Refactored to use the new URN-based identity model. It now constructs hierarchical URNs for employees based on the parent organization's URN.
-   **`EmployeeManager`:** Now retrieves the tenant's URN via `TenantsCacheManager` instead of requiring access to the full tenant configuration.
-   The issuer (`iss`) in API responses generated by `EmployeeManager` is now the tenant's sovereign URN.

### Deprecated

-   **`TenantsCacheManager.getConfig()`:** This method has been deprecated and will be removed. It exposed the entire `TenantConfig` object, violating the principle of least privilege. Use `getTenantUrn()` or `getDidServiceConfig()` instead.

### Removed

-   Removed direct dependency on `IServerConfig` from `EmployeeManager`. The required data is now provided by `TenantsCacheManager`.
