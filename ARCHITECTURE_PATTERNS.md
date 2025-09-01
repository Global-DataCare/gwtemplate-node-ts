# Architecture Patterns:

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