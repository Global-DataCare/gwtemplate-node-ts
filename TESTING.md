# Testing Guide

This document outlines the testing strategies and procedures for this project.
For E2E setup and GCP details, see `TESTING-GUIDE.md`.

## 1. Core Philosophy: The `IVaultRepository` Pattern

The application abstracts its confidential storage layer using the `IVaultRepository` interface (`src/database/repositories/vault/vault.repository.ts`). This allows the underlying database technology to be swapped without changing business logic.

The specific repository implementation is chosen at runtime based on the `VAULT_PROVIDER` environment variable.

-   **`mem`**: (Default) Uses `VaultMemRepository`, a fast, volatile, in-memory implementation ideal for most unit and integration tests.
-   **`firestore`**: Uses `FirestoreVaultRepository`, the production-grade implementation for Google Cloud Firestore.
-   **`mongo`**: (Future) A MongoDB implementation could be added here.

## 2. Jest Configuration

The project uses Jest as its test runner, configured via `jest.config.ts`. A key part of the configuration is the `jest.setup.ts` file, which is executed before any test suite runs.

This setup file is responsible for loading the correct environment variables (`.env` or `.env.test`) based on the test script being executed. This ensures that tests run in the correct, isolated environment.

Note on ESM dependencies: some packages (e.g. `gdc-common-utils-ts`, `gdc-sdk-client-ts`) ship ESM TypeScript sources. Tests run with `NODE_OPTIONS=--experimental-vm-modules`, and `ts-jest` is configured to transform those packages from `node_modules`.

## 3. Running Tests

-   **Unit & Fast Integration Tests:**
    ```shell
    npm test
    ```
    This command runs all tests that do not require external services. It primarily uses the `VaultMemRepository`.

-   **Firestore-Specific Tests:**
    Testing against Firestore requires a specific setup, either with a local emulator or a live GCP project. For detailed instructions on this, please refer to the dedicated guide:
    **[./TESTING-FIRESTORE.md](./TESTING-FIRESTORE.md)**

-   **E2E Tests (explicit opt-in):**
    E2E suites that touch external services are disabled by default. To run them, set the flags below (typically in your shell before running `npm run test:e2e`):
    ```shell
    # Firestore E2E (requires emulator or valid credentials)
    FIRESTORE_E2E=true

    # GCS E2E (requires valid credentials + bucket)
    GCS_E2E=true

    # Legacy API E2E (requires a real Firebase Auth user)
    TEST_USER_EMAIL=you@example.com
    TEST_USER_PASSWORD=your-password
    ```
    Notes:
    - E2E tests read from `.env.test` via `jest.setup.ts`.
    - Firestore E2E runs only when `FIRESTORE_E2E=true` and either `FIRESTORE_EMULATOR_HOST` or valid Google credentials are present.
    - GCS E2E runs only when `GCS_E2E=true` and `GCS_BUCKET_NAME` is set.
