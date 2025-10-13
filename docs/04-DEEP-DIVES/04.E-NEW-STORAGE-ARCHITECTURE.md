# New Storage Architecture Plan

This document outlines a proposed refactoring of the project's directory structure to improve coherence, scalability, and maintainability. The core goal is to unify the data access patterns under a clear Repository pattern, ensuring that business logic (Managers) remains decoupled from the underlying database implementation (Firestore, in-memory, etc.).

This change formalizes the original vision of a database-agnostic storage layer inspired by Hyperledger Aries, giving it a robust and consistent structure within the project.

## 1. Current Inconsistent Structure

The current structure has two competing patterns for data access: a generic "Storage Adapter" and a domain-specific "Repository".

-   **`src/storage`**: Contains a generic database abstraction (`database.abstract.ts`) and its implementations (`database.mem.ts`, `db.firebase.adapter.ts`). This acts as a generic key-value/document storage.
-   **`src/database/repositories`**: Contains a domain-specific repository (`ConsentRepository.ts`) with its own implementations for different databases.
-   **`src/adapters`**: Contains adapters for other external services like queues and blockchain, but not for database storage, which creates confusion.

This leads to ambiguity and makes it unclear where new data access logic should reside.

## 2. Proposed Coherent Structure

The proposal is to eliminate the `src/storage` directory and unify all data access logic under the **Repository pattern** within `src/database`.

The new structure will be:

```
src/
├── security/         # NEW: For encryption (JWE) and hashing (HMAC) logic.
│
├── adapters/         # For external services THAT ARE NOT the main database.
│   ├── blob-storage/ # NEW: To handle file storage in Google Cloud Storage.
│   ├── queue/
│   └── blockchain/
│
├── database/         # All data persistence logic resides here.
│   ├── connection/   # Handles DB connection setup (e.g., firebase.ts).
│   └── repositories/
│       ├── consent/  # Sub-directory for each domain entity.
│       │   ├── consent.repository.ts       # The abstract interface.
│       │   ├── consent.firestore.repository.ts # Firestore implementation.
│       │   └── consent.mongo.repository.ts   # Mongo implementation.
│       │
│       └── vault/    # The logic from `src/storage` is moved and formalized here.
│           ├── vault.repository.ts           # The interface (from database.abstract.ts).
│           ├── vault.firestore.repository.ts # Firestore implementation (from db.firebase.adapter.ts).
│           └── vault.mem.repository.ts       # In-memory implementation for demos/testing.
│
└── managers/         # Business logic, depends on repository interfaces.
    └── StorageManager.ts # Depends on VaultRepository, not a specific implementation.
```

## 3. Rationale for the Change

-   **Single Responsibility Principle**: `database` handles data persistence. `adapters` handles other external systems. `managers` handles business logic. The roles are clear.
-   **Clarity and Consistency**: All data access logic follows the same Repository pattern. It's immediately obvious where to find or add new data-related modules.
-   **Decoupling**: Managers will only depend on repository interfaces (e.g., `VaultRepository`), not concrete implementations. This makes it trivial to switch between the in-memory version for demos and the full-featured Firestore version for production.
-   **Scalability**: This structure cleanly supports the future vision:
    1.  **Blob Storage**: The `vault.firestore.repository.ts` can internally use a new `BlobStorageAdapter` to store large files, while keeping metadata in Firestore.
    2.  **Encryption**: The repository can use a `SecurityService` to handle JWE encryption and HMAC hashing before persisting data, without the manager needing to know.

## 4. Action Plan

1.  **Create `NEW_STORAGE_ARCH.md`**: Document this plan (this file).
2.  **Link in `README.md`**: Add a section to `README.md` linking to this document for team visibility.
3.  **Future Implementation**: When approved, execute the refactoring by moving files, renaming them according to the convention (`*.repository.ts`), and updating all imports across the application. The primary goal is to organize the code without changing its runtime behavior initially.
