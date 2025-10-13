# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Batch Processing & Identifier Generation in `CustomerManager`**:
  - Re-architected `CustomerManager` to correctly process `_batch` requests by handling each entry as a discrete customer creation.
  - Implemented logic to automatically generate a new `urn:uuid:...` identifier if an entry is submitted without one (User Story 1: Self-Onboarding).
  - Implemented logic to aggregate claims from multiple batch entries that share the same anchor `identifier` into a single, unified customer record (User Story 2: Professional Onboarding).
- **Canonical Customer Public ID**:
  - `CustomerManager` now enforces the creation of a canonical public identifier for customers based on the pattern: `urn:...:individual:multibase:z<base58btc(uuid)>`.
  - Added a new `uuidToBytes` utility to correctly convert UUID strings into 16-byte arrays for encoding.

### Fixed
- **`uuid` Library Mocking**: Corrected the Jest mock for the `uuid` library in `CustomerManager.test.ts` to include the `validate` function, resolving a persistent `TypeError: (0 , uuid_1.validate) is not a function` runtime error during tests.
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
