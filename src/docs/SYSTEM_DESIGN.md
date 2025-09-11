# System Design Specification

This document outlines the concrete architectural design of the Gateway API, implementing the high-level concepts from `ARCHITECTURE_PATTERNS.md`.

## 1. Dual Router Architecture

The application is split into two distinct routers to separate public, synchronous endpoints from private, asynchronous endpoints. This ensures clarity, security, and separation of concerns.

### 1.1. `discoveryRouter` (Synchronous, Public)

-   **File:** `src/routes/discovery.ts`
-   **Purpose:** Handles all public, synchronous, read-only discovery endpoints. These routes are designed to be fast, cacheable, and do not involve any queuing or background processing.
-   **Logic:** Uses a `DiscoveryService` to retrieve configuration data.
-   **Security:** Minimal. Primarily validates the path and the existence of the requested entity (`tenantId` or `host`).

### 1.2. `apiRouter` (Asynchronous, Secure)

-   **File:** `src/routes/api.ts`
-   **Purpose:** Handles all secure, asynchronous operations that modify state or require background processing (e.g., `_batch`, `_transaction`).
-   **Logic:** Follows the "Opaque Acceptance" pattern. Its primary job is to validate and queue jobs, not to execute them.
-   **Security:** Maximum. Protects against information leakage by making the endpoint behavior uniform regardless of the request's validity.

## 2. Asynchronous API Flow: "Opaque Acceptance" Pattern

To prevent attackers from discovering valid `tenantId`s, routes, or endpoint capabilities through probing, the `apiRouter` **MUST** follow a strict "Opaque Acceptance" flow for its `/_batch` submission endpoint.

1.  **Path Validation:** The router first performs non-cryptographic validations using the URL parameters (`:tenantId`, `:sector`, etc.). It checks:
    -   If the entity specified in `:tenantId` exists (via `TenantsCacheManager`).
    -   If the `sector` is globally allowed (via `config.sectorsAllowed`).
    -   If the entity's `didDocument` authorizes the specific route and action (via `isRequestValid`).

2.  **Cryptographic Validation:** Only if path validation succeeds, the router proceeds to the expensive cryptographic operations by calling `kmsService.decodeRequest()` on the request payload. This validates the JWE/JWS, signatures, and any embedded tokens.

3.  **Response and Queuing Logic:**
    -   **If Path or Crypto Validation Fails:** The server **MUST** immediately return `202 Accepted` with an empty body. It **MUST NOT** queue a job. The client, upon polling with their self-generated `thid`, will eventually receive a `404 Not Found`.
    -   **If Both Validations Succeed:** The server **MUST** queue the job for the worker and **MUST** return `202 Accepted` (optionally with the `thid` for convenience).

This ensures that from an external perspective, the submission endpoint's behavior is identical for valid and invalid requests, leaking no information.

## 3. Synchronous Discovery Service and Endpoints

### 3.1. `DiscoveryService`

-   **File:** `src/services/DiscoveryService.ts`
-   **Purpose:** A synchronous service responsible for fetching and formatting public configuration documents. It is injected into the `discoveryRouter`.

### 3.2. Discovery Endpoints

The `discoveryRouter` will expose the following endpoints.

#### Core Endpoints (Always Enabled)
-   `GET /:tenantId/.well-known/did.json`
-   `GET /:tenantId/.well-known/openid-configuration`
-   `GET /:tenantId/.well-known/oauth-authorization-server`

#### FHIR-Specific Endpoints
These endpoints should be implemented in the router but will only be active if the resolved `TenantConfig` belongs to a FHIR-enabled sector (e.g., `health-care`, `emergency`, `health-insurance`). The `host` entity **MUST NOT** expose these endpoints.

-   `GET /:tenantId/.well-known/smart-configuration`
-   `GET /:tenantId/fhir/metadata` (Note: Path is per FHIR specification)

## 4. Role Separation and Path Authorization

To ensure a strict separation of concerns between platform administration and tenant operations, the following authorization rules **MUST** be enforced at the router level.

### 4.1. Host (`:tenantId` = `host`)

The `host` entity is exclusively for platform administration.
-   **ALLOWED:** It **MUST** be allowed to access administrative sections, such as `registry` for `Organization` resources.
-   **DENIED:** It **MUST NOT** be allowed to access business-specific sections or sectors (e.g., `health-care`, `ping`).

### 4.2. Tenants (`:tenantId` != `host`)

Tenants are for business operations.
-   **ALLOWED:** They **MUST** be allowed to access business sections and sectors for which they are configured (e.g., `ping`, `health-care`).
-   **DENIED:** They **MUST NOT** be allowed to access platform-level administrative sections like `registry`.

