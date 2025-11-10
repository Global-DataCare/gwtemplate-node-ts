# TODO: Final Architecture Implementation for Firestore

## Goal
Implement the correct architecture for Firestore persistence, aligning with the existing `IVaultRepository` interface and the established tenancy model. This guide contains the final, correct plan after multiple iterations.

---

### Phase 1: Solidify the `TenantsCacheManager` as the Central Translator

The `TenantsCacheManager` is the **only** component that understands the relationship between a logical `vaultId` (e.g., `'health-care_acme'`) and a physical `collectionName` (e.g., `'ES_TAX_B12345678_health-care'`).

**Tasks:**
1.  **Create Utility Function:** In `src/utils/tenant.ts`, ensure the function `generateTenantCollectionNameFromClaims(claims: ClaimsRecord): string` exists and is correctly implemented. It should build the collection name string from the tenant's immutable claims.

2.  **Update `TenantsCacheManager` Logic:**
    -   In the `loadTenants` method (and any lazy-loading logic), after a tenant's `EntityConfig` is successfully decrypted:
        a. Call `generateTenantCollectionNameFromClaims(tenantConfig.claims)` to get the physical collection name.
        b. Add this name as a new property to the cached object: `tenantConfig.collectionName = 'ES_TAX_...'`.
        c. For the special case of the `'host'`, its `collectionName` is simply `'host'`.
    -   The object stored in `this.tenantCacheByVaultId` must contain the `collectionName`.

3.  **Expose the Translation:**
    -   Add a new public method to `TenantsCacheManager`: `public getCollectionName(vaultId: string): string | undefined`. This method will retrieve the cached object for the `vaultId` and return its `collectionName` property.

---

### Phase 2: Refactor `FirestoreVaultRepository` to be a "Dumb" Executor

This repository must be agnostic to business logic. It operates on physical `collectionName`s.

**Tasks:**
1.  **Refactor the Constructor:** The constructor should be simple: `constructor(db: admin.firestore.Firestore, hostCollectionName: string)`. It receives the database instance and the physical collection name for the host, which it needs for the `vaultExists` method.

2.  **Implement `vaultExists(vaultId: string)` Correctly:** This method's logic should be:
    ```typescript
    async vaultExists(vaultId: string): Promise<boolean> {
      // Uses the injected hostCollectionName to look for the tenant's registration doc.
      const doc = await this.get(this.hostCollectionName, vaultId, 'tenants');
      return doc !== undefined;
    }
    ```

3.  **Implement `createNewVault(vaultConfig: VaultConfig)` Correctly:** This method must be a documented **no-op** that satisfies the interface.
    ```typescript
    async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
      // This is intentionally a no-op in the Firestore implementation.
      // The tenant's registration record is created via a `put` call in the HostingManager.
      // This method exists to satisfy the shared IVaultRepository interface.
      return Promise.resolve(true);
    }
    ```

4.  **Verify Data Methods:** Ensure that `put`, `get`, and `query` all use the `collectionName` parameter they receive to perform their database operations. Their first argument must be `collectionName: string`.

---

### Phase 3: Refactor `HostingManager` as the Orchestrator

This manager drives the tenant creation process.

**Tasks:**
1.  **Refactor Constructor:** Change the constructor from `(..., config: IServerConfig)` to `(..., options: { namespace: string, apiBaseUrl: string, ... })` to use specific dependencies, not the entire config object.

2.  **Restore Validation Logic:** In `processRegistrationEntry`, the check for an existing tenant **must be restored**.
    ```typescript
    const vaultId = getTenantVaultId(validatedSector, alternateName);
    if (await this.vaultRepository.vaultExists(vaultId)) {
      throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
    }
    ```

3.  **Refactor `persistTenantConfig`:** This is the most critical flow.
    -   It must prepare the `ConfidentialStorageDoc` for the new tenant. **Crucially, its `id` property MUST be the logical `vaultId`** (e.g., `'health-care_acme'`).
    -   It must then get the host's collection name: `const hostCollectionName = this.tenantsCacheManager.getCollectionName('host');`
    -   It then makes **one call to register the tenant**: `await this.vaultRepository.put(hostCollectionName, [secureTenantDoc], 'tenants');`. The call to `createNewVault` is removed.
    -   It then forces a cache reload: `await this.tenantsCacheManager.loadTenants();`.
    -   It then gets the **new tenant's collection name**: `const newTenantCollectionName = this.tenantsCacheManager.getCollectionName(vaultId);`.
    -   Finally, it prepares the `ConfidentialStorageDoc` for the legal representative and calls `put` on the new tenant's collection: `await this.vaultRepository.put(newTenantCollectionName, [legalRepDoc], 'employees');`.

4.  **Refactor `persistHostConfig`:** This method should follow a similar pattern, using `put` calls with the host's collection name to save its own configuration and its founding administrator.

---

### Phase 4: Implement Attachment Handling for Terms of Service

The creation of a tenant involves processing an attached PDF for the Terms of Service. This logic must be integrated into the `HostingManager`.

**Architectural Decisions:**
-   **Input Format:** The PDF file will be received as a Base64-encoded string within the `org.schema.Service.termsOfService` claim in the request. This keeps the request self-contained.
-   **Storage:** The binary PDF data will be stored in a Google Cloud Storage bucket, not in Firestore. Firestore will only store a pointer (URL and hash) to the file.
-   **File Naming:** The file in the bucket will be named using its SHA3 hash (e.g., SHA3-256) encoded with Multibase. This ensures content-addressable, immutable storage.
-   **Credential Evidence:** The resulting public URL and the file's hash will be used to construct the `evidence` field for credentials, following the OpenID4IDA specification.

**Tasks:**
1.  **Create a new `StorageService`:**
    -   Create an interface `IStorageService.ts` with a method like `upload(buffer: Buffer, fileName: string): Promise<{ publicUrl: string; hash: string; }>`.
    -   Create a concrete implementation `GoogleCloudStorageService.ts` that uses the `@google-cloud/storage` SDK. This service will require configuration (bucket name) from `.env` variables.
2.  **Integrate into `HostingManager`:**
    -   Inject the `IStorageService` into the `HostingManager`.
    -   In `persistTenantConfig` (and `persistHostConfig`), add the following logic:
        a. Check if the `service.meta.claims['org.schema.Service.termsOfService']` field exists and looks like a Base64-encoded PDF.
        b. If it exists, decode it into a `Buffer`.
        c. Use a utility (e.g., from `src/utils/urn-hash.ts`) to calculate the SHA3 hash of the buffer.
        d. Use a utility (e.g., from `src/utils/multibase58.ts`) to encode the hash. This will be the file name.
        e. Call `storageService.upload(pdfBuffer, fileName)` to upload the file to the bucket.
        f. Take the returned `publicUrl` and `hash` and add them to the `service` resource or the tenant's `EntityConfig`. This data will be persisted in Firestore as part of the tenant's record and used later by the `CredentialManager`.

---

### Phase 5: Assemble Dependencies in `server.ts`

**Tasks:**
1.  **Read Config:** Read all necessary variables from the `.env` file, including the new Google Cloud Storage bucket name.
2.  **Initialize Services:** Initialize the `GoogleCloudStorageService` and the Firebase Admin SDK.
3.  **Generate Host `collectionName`:** Generate the host's physical collection name *once* using its claims from the config. In the host's case, the logical `vaultId` and physical `collectionName` are both simply `'host'`.
4.  **Instantiate `FirestoreVaultRepository`:** Create the instance, injecting the `db` instance and the `hostCollectionName`.
    ```typescript
    const hostCollectionName = 'host'; // Per design
    const db = admin.firestore();
    const vaultRepository = new FirestoreVaultRepository(db, hostCollectionName);
    ```
5.  **Instantiate Managers:** Create instances of `TenantsCacheManager` and then `HostingManager`, injecting the correct dependencies, including the new `storageService`.

---

### Phase 6: Verification

1.  Run `npx tsc --noEmit` to ensure there are no compilation errors.
2.  Run `npm run dev`. The server should start without errors.
3.  Execute the `curl` commands from the documentation to test the creation of the `acme` tenant, ensuring the PDF is uploaded and the correct metadata is stored.

