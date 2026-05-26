# AI Development and Architecture Rules

This document contains key architectural principles and rules for the AI assistant to follow during development. It serves as a guide for both human developers and the AI to ensure consistency.

## 1. Resource ID vs. Identifier (`ResourceIdDerivation`)

This rule governs the distinction between a resource's internal `id` and its public `identifier`(s).

- **Rule:** The `id` field of a JSON:API resource object MUST be an internal, stable, and unique UUID used for linking and database lookups.
- **Derivation:** This `id` MUST be derived from the `org.schema.<Type>.identifier` claim. The primary identifier within this claim is expected to be a URN of the format `urn:uuid:<value>`. The utility `determineResourceId` is responsible for extracting this `<value>`.
- **Normalization:** After deriving the resource `id` (which is a pure UUID), the `org.schema.<Type>.identifier` claim within `meta.claims` **MUST be normalized and overwritten**. The new value MUST be a canonical URN created by passing the derived `id` to the `createUrnFromUuid` utility. This ensures data consistency.
- **Preservation:** All original claims, except for the normalized `identifier` claim, MUST be preserved in their original form within the resource's `meta.claims` object.
- **Public Identifiers:** Claims like `taxID` are considered primary **public identifiers**, especially when combined with context like `addressCountry`. They are crucial business identifiers but are NOT to be used as the internal resource `id`. They are preserved in `meta.claims`.

## 2. Response Structure: Template-Centric JSON:API Document (`ResponseStructure`)

This rule defines the specific JSON:API structure for the response from a template-based process like organization registration. This pattern is PRIMARY.

- **Rule:** The manager's output payload MUST be a valid JSON:API Primary Document representing the outcome of the template processing.

- **`data` Array (Primary Data):**
    - MUST contain a single **`template` resource object**. This object represents the successful processing of the input form (e.g., "OrgRegistrationForm").
    - Its `id` MUST be a unique UUID for this transaction.
    - Its `meta` object SHOULD contain the original `templateId`, `templateVersion`, and the complete `claims` from the request.
    - It MUST have a `relationships` object linking to all resources created during the process.

- **`included` Array (Resulting Resources):**
    - MUST contain ALL concrete resources created from the template's claims.
    - For organization registration, this includes the `Organization`, `Person`, AND `Service` resource objects.

- **Analogy:** The `template` in `data` is the "receipt" for the transaction. The resources in `included` are the "items" purchased with that transaction.

## 4. API Flow: FAPI, DIDComm, and Asynchronous Responses (`SecureAsynchronousApiFlow`)

This rule defines the primary communication pattern for the API, which is secure and asynchronous by default, following FAPI-grade principles.

- **Principle:** For sensitive operations, the API is **asynchronous by default**. The client submits a job and polls for the result. This makes the system agnostic to the transport protocol and robust enough for processes that may take time (like blockchain anchoring).

- **Request Flow (Protected):**
    - The client creates the core business payload (the `HybridPayload`'s `data` array with one or more `entry` objects).
    - This payload is placed inside a `job` object, which includes security metadata like `response_type` (e.g., `api+json`, `fhir+json`) and `response_mode` (e.g. `jwt` for demo, but `didcomm-encrypted+json` will be for production).
    - This `job` is then wrapped in a secure DIDComm/JWE/JWS message.
    - This encrypted message is sent as a single `request` parameter in a POST request with `Content-Type: application/x-www-form-urlencoded`.
    - The server provides its public keys for this process at `/.well-known/jwks.json`.

- **Response Flow (Asynchronous):**
    1.  **Immediate Response:** The server's API handler decodes the secure envelope. If valid, it initiates a background job, and immediately returns an HTTP `202 Accepted` response with the job's thread ID (`thid`).
    2.  **Polling:** The client periodically queries a results endpoint using the `thid`.
    3.  **Final Response:** Once the job is complete, the results endpoint returns the final response, which is also a secure DIDComm/JWE message.

- **Role of Managers (`OrganizationManager`, etc.):**
    - Managers operate **synchronously**.
    - Their responsibility is to execute the business logic on the **decoded `job` payload** they receive from the API handler.
    - They MUST return the standard internal `HybridPayload` object. They are completely unaware of the outer layers of security (JWE/DIDComm) and asynchronicity.

- **Content Negotiation:**
    - The final transformation of the manager's `HybridPayload` (e.g., renaming `data` to `entry` for FHIR compliance) is performed by the API handler, based on the `response_type` parameter from the original job request.

---
## 5. The User's Code is the Source of Truth (`SourceOfTruth`)

- **Rule:** The user's existing code, models, and explicit instructions are the **absolute and immutable source of truth**.
- **Prohibition:** The AI is strictly prohibited from inventing its own data structures, models, or logic when a user-provided example or existing file is available.
- **Process:** Before implementing any feature, the AI MUST first read all relevant existing files mentioned by the user to ensure 100% conformity with the established architecture and naming conventions. There are no exceptions to this rule.

## 6. Business vs. Cryptography Models (`ModelSeparation`)

- **Data Flow & Serialization:** When a manager needs to encrypt a business object (e.g., a `TenantConfig`), it MUST first **serialize** it.
    - For structured data (objects, arrays), the manager MUST call `JSON.stringify` on the object.
    - This resulting `string` (or `Uint8Array` for binary data) is then passed in the `plaintext` property of the `UnencryptedJWE` object to the crypto service.
- **Prohibition:** The `ICryptoService` MUST NOT accept raw objects in its `encrypt` method. Its responsibility begins with the already-serialized `plaintext`.

## 7. Manager-KMS Interaction (`HighLevelKmsUsage`)

- **Rule:** Managers (e.g., `OrganizationManager`) MUST interact with the `IKmsService` at a high level of abstraction. They are consumers of security, not implementers of it.
- **Prohibition:** Managers are strictly prohibited from calling low-level cryptographic methods like `encrypt` or `decrypt` directly.
- **Correct Flow:** To persist a secure document, a manager MUST:
    1. Construct the complete `ConfidentialStorageDoc` with the **plaintext `content`** and the `indexed` attributes.
    2. Call the high-level method `kmsService.protectDocument(doc, entityId)`.
    3. Take the returned secure document (which now has `jwe` and no `content`) and pass it to the `vaultRepository`.
- **Rationale:** This enforces separation of concerns. The manager knows *what* to save; the KMS knows *how* to secure it.

