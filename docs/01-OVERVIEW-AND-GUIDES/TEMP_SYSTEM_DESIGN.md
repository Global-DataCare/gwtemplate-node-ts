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
-   **Logic:** Validates requests and queues jobs. Invalid requests are rejected immediately.
-   **Security:** Enforces path and cryptographic validation before queuing any job.
-   **Endpoint Naming Convention:** Asynchronous operations follow a strict `POST /.../_action` and `POST/GET /.../_bundleType` convention (e.g., `_batch` is polled via `_batch-response`).

## 2. Asynchronous API Flow: Early Validation with Explicit Rejection

The gateway follows a standard RESTful pattern of validating requests before processing. This provides clear and immediate feedback to clients and is compliant with standards like the FHIR Asynchronous Request Pattern.
### 2.1. Endpoint Naming Convention

The API uses a semantic naming convention that links an asynchronous action to the type of FHIR Bundle its result will produce.
-   **Job Submission:** `POST /.../{_action}` (e.g., `_batch`, `_search`)
-   **Job Polling:** `POST` or `GET /.../{_bundleType}` where `_bundleType` corresponds to the expected response (e.g., `_batch-response`, `_searchset`).

### 2.2. Job Submission (`POST /.../{_action}`)
1.  **Path Validation:** The router first performs non-cryptographic validations using URL parameters. It checks for the entity's existence and if the route is authorized in its `didDocument`.
    -   **If Path Validation Fails:** The server **MUST** return an immediate `404 Not Found` with an `OperationOutcome`.

2.  **Payload/Content-Type Validation (Future Work):** The router will validate the `Content-Type` header against the tenant's supported modes.
    -   **If Invalid:** The server **MUST** return an immediate `415 Unsupported Media Type`.
3.  **Cryptographic Validation:** If the path is valid, the router proceeds with cryptographic validation (`kmsService.decodeRequest()`).
    -   **If Crypto Validation Fails:** The server **MUST** return an immediate `400 Bad Request` or `401 Unauthorized` with an `OperationOutcome`.

4.  **Successful Queuing:** If all validations succeed, the server **MUST** queue the job and return `202 Accepted` with a `Location` header pointing to the polling endpoint.
### 2.3. Job Polling (`/.../{_bundleType}`)

-   **`POST` (Default Method):** The client makes a `POST` with the `thid` in an `application/x-www-form-urlencoded` body.
-   **`GET` (FHIR Conformance):** For tenants in FH-enabled sectors, a `GET` request with a `thid` query parameter is also supported.
-   **Responses:** `202` (Pending), `200` (Completed), `404` (Unknown `thid`).

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

### 4.3. Default Service Endpoint Generation

To simplify tenant onboarding, the system **MUST** automatically generate a default set of `service` endpoints in the tenant's `didDocument` upon registration. This logic is handled by the `OrganizationManager` and is based on the tenant's `sector`.

-   **Universal Services:** The `ping` service is enabled for all tenants, regardless of sector.

-   **Sector-Specific Services:**
    -   **FHIR Sectors (`health-care`, `emergency`, etc.):** Tenants in these sectors will have endpoints enabled for FHIR resources (`Patient`, `Practitioner`, `Location`, etc.) under the `org.hl7.fhir.r4` format.
    -   **Non-FHIR Sectors (`finance`, etc.):** Tenants in these sectors will have endpoints enabled for equivalent resources (`Customer`, `Employee`, `Place`, etc.) under the `org.schema` format.

-   **Bundle Support:** For each enabled `section` (e.g., `entity`, `individual`), a service endpoint for the `Bundle` resource type **MUST** also be created. This allows clients to submit multiple resources in a single `_batch` operation.

This automated configuration ensures that tenants are immediately functional for their specific domain without requiring manual `didDocument` editing post-registration.

---

## 5. Security Architecture and Key Management

This section details the layered architecture of the security services, defining a clear separation of concerns for all cryptographic operations.

### 5.1. Core Principles

-   **Separation of Concerns:** Each service has a single, well-defined responsibility. Business logic is strictly separated from cryptographic operations, and key management is separated from public key discovery.
-   **Least Privilege:** Components only have access to the cryptographic material and functions essential for their role. For example, a `Manager` never handles raw private keys.

### 5.2. The Security Layers

The system is designed with a clear, bottom-up hierarchy of security services.

-   **Layer 0: The Crypto Engine (`CryptographyService`)**
    -   **Responsibility:** A stateless "toolbox" of pure, low-level cryptographic functions.
    -   **Functions:** `generateMldsaKeyPair`, `generateMlkemKeyPair`, `sign`, `verifyJws`, `encrypt`, `decrypt`.
    -   **Knowledge:** It knows *how* to perform crypto math. It knows nothing about entities, key storage, or business logic. It operates on the raw keys it is given.

-   **Layer 1: The Key Guardian (`KmsService`)**
    -   **Responsibility:** The secure, stateful vault for all **internal private keys** (e.g., for the Host, Tenants, and encrypted employee seed parts). It is the only component that should directly use the `CryptographyService` for operations involving internal keys.
    -   **Functions:** `provisionKeys`, `signWithManagedKey`, `signWithReconstructedKey`, `decodeRequest`.
    -   **Knowledge:** It knows *which* private key belongs to an internal `entityId`. It knows *how* to reconstruct an employee's key from seeds. It does not know how to find external public keys.

-   **Layer 2: The Public Key Detective (`DidResolverService`)**
    -   **Responsibility:** The single source of truth for finding **public keys** of any entity, whether internal or external.
    -   **Functions:** `resolveVerificationKey(did: string, kid?: string)`.
    -   **Knowledge:** It implements a cache-aside strategy:
        1.  Check local cache (e.g., Redis).
        2.  If cache miss, check internal storage (by calling a `Manager` to query a local `vault`).
        3.  If still not found, check external sources (e.g., query a Hyperledger Fabric blockchain via a `FabricAdapter`).
        4.  It populates the cache before returning the key.

-   **Layer 3: The Business Logic Orchestrators (`Managers`)**
    -   **Responsibility:** To implement the application's business logic. They are the primary consumers of the other security layers.
    -   **Knowledge:** They understand business identifiers (e.g., an `email` or `alternateName`). They orchestrate the security services to execute workflows.

-   **Layer 4: The API Facade (`Controllers` & `Routes`)**
    -   **Responsibility:** To handle incoming HTTP requests, perform basic validation, and route them to the appropriate `Manager`.

### 5.3. Key Cryptographic Workflows

-   **Workflow 1: Verifying an External Signature**
    1.  **`Controller`** receives a JWS and passes it to the `TenantManager`.
    2.  **`TenantManager`** extracts the issuer DID and `kid` from the JWS header.
    3.  **`TenantManager`** calls `didResolverService.resolveVerificationKey(did, kid)` to get the external public key.
    4.  **`TenantManager`** calls `cryptographyService.verifyJws(jws, publicKey)` to perform the final mathematical verification.

-   **Workflow 2: Creating a Tenant Signature (Managed Key)**
    1.  **`Controller`** passes a request to the `TenantManager`.
    2.  **`TenantManager`** determines it needs to sign a credential on behalf of the tenant.
    3.  **`TenantManager`** calls `kmsService.signWithManagedKey(payload, tenantId)`.
    4.  **`KmsService`** finds the tenant's private key in its internal storage and uses it to sign the payload.

-   **Workflow 3: Creating an Employee Signature (Reconstructed Key)**
    1.  **`Controller`** passes a request containing `seedPartA` to the `EmployeeManager`.
    2.  **`EmployeeManager`** retrieves the `encryptedSeedPartB` from the employee's record in the vault.
    3.  **`EmployeeManager`** calls `kmsService.signWithReconstructedKey(payload, seedPartA, encryptedSeedPartB, tenantId)`.
    4.  **`KmsService`** uses the `tenantId` key to decrypt `seedPartB`, combines it with `seedPartA`, generates the employee's key in memory, signs the payload, and securely disposes of the key material.
