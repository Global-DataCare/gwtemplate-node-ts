# Testing Guide

This document outlines the testing strategies and procedures for this project.

## 1. Core Philosophy: The `IVaultRepository` Pattern

The application abstracts its confidential storage layer using the `IVaultRepository` interface (`src/database/repositories/vault/vault.repository.ts`). This allows the underlying database technology to be swapped without changing business logic.

The specific repository implementation is chosen at runtime based on the `VAULT_PROVIDER` environment variable.

-   **`mem`**: (Default) Uses `VaultMemRepository`, a fast, volatile, in-memory implementation ideal for most unit and integration tests.
-   **`firestore`**: Uses `FirestoreVaultRepository`, the production-grade implementation for Google Cloud Firestore.
-   **`mongo`**: (Future) A MongoDB implementation could be added here.

## 2. Jest Configuration

The project uses Jest as its test runner, configured via `jest.config.ts`. A key part of the configuration is the `jest.setup.ts` file, which is executed before any test suite runs.

This setup file is responsible for loading the correct environment variables (`.env` or `.env.test`) based on the test script being executed. This ensures that tests run in the correct, isolated environment.

## 3. Running Tests

-   **Unit & Fast Integration Tests:**
    ```shell
    npm test
    ```
    This command runs all tests that do not require external services. It primarily uses the `VaultMemRepository`.

-   **Firestore-Specific Tests:**
    Testing against Firestore requires a specific setup, either with a local emulator or a live GCP project. For detailed instructions on this, please refer to the dedicated guide:
    **[./TESTING-FIRESTORE.md](./TESTING-FIRESTORE.md)**
