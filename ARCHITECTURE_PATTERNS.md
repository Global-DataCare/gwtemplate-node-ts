This document is the formal specification for the architecture. It is the definitive guide and "prompt" for all development.

## 1. The Asynchronous API Flow (The Golden Rule)

All resource write operations (`_update`, `_batch`) are asynchronous. This design is intentionally aligned with secure, decoupled communication patterns like **FAPI (Financial-grade API)** and **DIDComm**, where interactions are often handled as jobs rather than synchronous request-response cycles.

1.  **Request:** The client `POST`s a **DIDComm Message Envelope** containing a standardized data `Bundle`. The request is sent to a dynamic API endpoint.
2.  **Validation & Queuing:** The **API Router** validates the request against the tenant's service policy. If valid, it generates a `thid` (Transaction ID) and pushes a `JobRequest` into the **Queue**.
3.  **Immediate Response (`202 Accepted`):** The client immediately receives a `202 Accepted` response containing the `thid`.
4.  **Background Processing:** The **Worker** picks up the job. It calls the appropriate **Manager**.
5.  **Format-Agnostic Business Logic:** The **Manager** executes the business logic. It operates on a canonical, internal data model and knows nothing about the final output format (e.g., FHIR or JSON:API). It returns a simple `ManagerResult` object (`{ successEntries, errorEntries }`).
6.  **Response Formatting:** The **Worker** receives the `ManagerResult`. It checks the original request format and uses `bundle.ts` utilities to format the result into the correct final response `Bundle` (FHIR or JSON:API), including correctly formatted errors. This final `Bundle` is stored in the `ResponseStore`, keyed by the `thid`.
7.  **Polling for Results:** The client `POST`s to the same API path with the `_search` action, providing the `thid` in the body. The API Router retrieves and returns the final `Bundle` from the `ResponseStore`.

**Important Exception:** The `/ .well-known` endpoints for public key and DID discovery are *synchronous*.

## 2. API Structure

*   **Asynchronous Operations:** `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/{section}/{format}/{resourceType}/{action}`
*   **Synchronous Discovery:** `GET /{tenantId}/.well-known/{file}`

## 3. The Manager Contract

*   **Input:** A canonical `Bundle` with a `data` array.
*   **Output:** A `Promise<ManagerResult>`.
*   **Responsibility:** Pure, format-agnostic business logic. **MUST NOT** build response bundles.

## 4. The `BundleEntry` Contract

*   The `claims` for business logic **MUST** be located in `entry.meta.claims`.
*   The `entry.resource` contains the original resource for auditing and reference.

## 5. The Worker's Responsibilities

1.  **Normalize Input:** The first crucial step is to normalize any incoming `Bundle` into the canonical internal format. This means that if the original bundle follows the FHIR standard (using an `entry` array), it **MUST** be converted to the internal standard which uses a `data` array (inspired by JSON:API). This ensures managers always receive a consistent data structure.
2.  **Route Jobs:** Call the correct manager based on the `JobRequest`.
3.  **Format Output:** Take the `ManagerResult` and build the final, correctly formatted response `Bundle`.

## 6. Universal Naming Convention

To ensure traceability and consistency, the system uses a universal naming convention for asynchronous events, whether they are jobs in the queue or message threads. All naming logic is centralized in `src/utils/naming.ts`.

### 6.1. Job Names

*   **Purpose:** To uniquely identify a job in the queue for routing and debugging.
*   **Structure:** `<timestamp>_<tenantId>_<resourceType>_<action>`
*   **Example:** `1678886400000_org1_Employee_batch`
*   **Implementation:** The `ApiRouter` **MUST** use `createJobName()` to generate the name. The `Worker` **MUST** use `parseJobName()` to analyze the name and route the job. The `switch` statement on a simple name is deprecated.

### 6.2. Messaging Section IDs

*   **Purpose:** To uniquely identify a conversation thread (e.g., an inbox or sent folder) within a messaging vault (like a `Group` or `List`).
*   **Structure:** `<timestamp>_<parentId>_<destinationId>_<type>`
*   **Example:** `1678886400000_group123_member456_inbox`
*   **Implementation:** A future `MessagingManager` **MUST** use `createMessageSectionId()` to generate these identifiers.

## 7. Data Storage Patterns

The entire data persistence layer is abstracted to ensure business logic remains agnostic to the underlying database technology (e.g., in-memory for testing, Firestore for production).

*   **The Repository Pattern:** All direct database interactions are encapsulated within **Repositories**. A repository defines a contract (an interface) for a specific domain entity (e.g., `VaultRepository`, `ConsentRepository`).
*   **Agnostic Managers:** Managers **MUST NOT** interact directly with any database driver (like Firestore or Mongo). They **MUST** only depend on the repository interfaces.
*   **The `VaultRepository` Contract:** This is the primary storage abstraction, evolving from the original `DatabaseAbstract`. It defines the core methods for interacting with the confidential storage system, such as `createNewVault`, `put` (to add records to a section), `get`, `getAllSections`, etc.
*   **Implementation Injection:** The specific implementation of a repository (e.g., `VaultMemRepository` or `VaultFirestoreRepository`) is injected into the managers at runtime, allowing the application to switch between storage backends without changing any business logic.

This pattern is fundamental to the system's testability and future-proofing, allowing for the adoption of different database technologies without rewriting core logic.

## 8. Phase 2: The Persistent Messaging Model (Inbox/Sent)

Once the core asynchronous API is stable, the next architectural layer is the implementation of a persistent, DIDComm-based messaging system. The temporary `ResponseStore` used for polling is **NOT** part of this system.

*   **Core Concept:** `Groups` and `Lists` are not just resources; they are **vaults** that can contain message threads.
*   **DIDComm Alignment:**
    *   `pthid` (Parent Thread ID): This will correspond to the `vaultId` of the `Group` or `List` where the conversation is happening.
    *   `thid` (Thread ID): This will correspond to a `section` within the parent vault, representing a specific conversation.
*   **Data Structure (Sections):**
    *   Within a messaging vault (a `Group` or `List`), data will be partitioned into `inbox` and `sent` sections.
    *   The section names will follow a specific convention, allowing for messages to be routed to/from specific members or other groups.
*   **Example Section IDs:** `"<vaultId>_inbox_<member-or-groupId>"` or `"<vaultId>_sent_<member-or-groupId>"`.
*   **Workflow:**

    1.  The `Worker` processes a job and gets a final `Bundle` response.
    2.  In addition to storing the result in the temporary `ResponseStore`, the `Worker` passes the `Bundle` to a future `MessagingManager`.
    3.  The `MessagingManager` analyzes the `Bundle` to determine the sender and recipients and writes the message to the appropriate `inbox` and `sent` sections in the corresponding vaults.

---

## 9. Resource Identification and Normalization

This section defines the canonical process for handling resource identifiers within the system, ensuring a clear distinction between internal database IDs and public business identifiers.

### 9.1. Core Principles

- **Internal ID (`id`):** Every resource object (Organization, Person, etc.) in a response payload MUST have a top-level `id` field. This `id` MUST be a pure, non-prefixed UUID (e.g., `"a1b2c3d4-..."`). It is used for database indexing, foreign key relationships, and unambiguous internal referencing.

- **Public Identifier (`identifier` claim):** This is the identifier provided in the incoming claims (e.g., from a registration form).
    - Its primary format is a URN, typically `urn:uuid:<value>`.
    - It represents the "source of truth" for the resource's identity at the time of the request.

- **Business Identifiers (`taxID`, etc.):** These are critical public identifiers used for business-level validation and lookup (e.g., ensuring an organization with a specific `taxID` and `country` is unique). They are preserved as-is but are NEVER used as the internal resource `id`.

### 9.2. The Normalization Flow

To ensure data consistency, the following flow is mandatory when processing resources from claims:

1.  **Determine the Internal `id`:** The internal `id` (the pure UUID) is derived from the `org.schema.<Type>.identifier` claim using the `determineResourceId` utility. This utility is responsible for:
    - Extracting the UUID from a valid `urn:uuid:<value>` string.
    - Generating a new UUID if the claim is missing or invalid.
    - Accepting non-UUID identifiers in `demo` mode.

2.  **Normalize the `identifier` Claim:** Once the internal `id` (the pure UUID) is determined, the original `org.schema.<Type>.identifier` claim within the resource's `meta.claims` object **MUST BE OVERWRITTEN**.

3.  **Create the Canonical URN:** The new value for the `identifier` claim is created by passing the determined internal `id` to the `createUrnFromUuid` utility.

**Example:**

- **Incoming Claim:** `org.schema.Person.identifier: "urn:uuid:a1b2c3d4-..."`
- **Processing Result:**
    - `Person.id`: `"a1b2c3d4-..."` (derived by `determineResourceId`)
    - `Person.meta.claims['org.schema.Person.identifier'`: `"urn:uuid:a1b2c3d4-..."` (re-created and normalized by `createUrnFromUuid`)

---

## 10. Secure Persistence Flow

This pattern describes the mandatory sequence of operations a manager must follow to persist a sensitive document securely in a vault, ensuring separation of concerns between business logic, security, and storage.

### 10.1. Actors

-   **Manager** (e.g., `OrganizationManager`): Knows the business logic. Responsible for creating the business data (the `content`) and its searchable indexes (`indexed`).
-   **IKmsService** (Key Management Service): Knows how to secure data for a tenant. Manages key access and orchestrates encryption.
-   **VaultRepository**: Knows how to write data to the underlying storage. It is "dumb" regarding cryptography.

### 10.2. Sequence

1.  **Manager: Construct Plaintext Document**
    - The manager creates a complete `ConfidentialStorageDoc` object.
    - It populates the `indexed` array with the necessary searchable attributes.
    - It populates the `content` property with the full, sensitive business object (e.g., `TenantConfig`). The `jwe` property is left empty.

2.  **Manager: Request Protection from KMS**
    - The manager calls `await this.kmsService.protectDocument(docToProtect, tenantId)`.
    - It passes the entire plaintext document and the ID of the tenant who will own the data.

3.  **KMS: Perform Encryption**
    - The `IKmsService` implementation receives the document.
    - It takes the `doc.content` object and serializes it (e.g., `JSON.stringify`).
    - It calls its internal, low-level crypto engine (`ICryptography.encrypt`) to turn the serialized `plaintext` into a `JWEData` object.
    - It creates a new "secure" document by copying the original, setting the `jwe` property with the result, and **deleting the `content` property**.
    - It returns this new secure document to the manager.

4.  **Manager: Persist Secure Document**
    - The manager receives the secure document from the KMS.
    - It calls `await this.vaultRepository.put('vault', [secureDoc], 'section')`, passing the secure document to the storage layer.

### 3. Result

The data is stored securely at rest. The `content` only ever exists in memory within the KMS's secure boundary during the encryption process, and the repository only ever sees the encrypted `jwe` object.

