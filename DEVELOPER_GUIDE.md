# Developer Guide

This guide provides practical instructions for setting up and running the project, and for interacting with its API.

## Project Setup

1.  **Install Dependencies:**

    ```bash
    npm install
    ```

2.  **Environment Variables:**

    Create a `.env` file in the root of the project. You can copy `.env.example` if it exists. At a minimum, you will need to define `PORT`.

3.  **Run the Development Server:**

    ```bash
    npm run dev
    ```

    The server will start, typically on port 3000.

4.  **Run Tests:**

    ```bash
    npm test
    ```

## Core Architectural Concepts

Before contributing code, it is **essential** to read and understand the core architectural principles:

*   **[Architecture Patterns (`ARCHITECTURE_PATTERNS.md`)](ARCHITECTURE_PATTERNS.md)**: This document explains the secure asynchronous API flow, data models, and key architectural decisions. It is the primary source of truth for "how we build things".
*   **[Organization Registration Process (`src/docs/organization_registration.md`)(src/docs/organization_registration.md)**: Details the specific process of registering new organizations (tenants) within the system.
*   **[Testing Strategy (`src/__tests__/README.md`)(src/__tests__/README.md)**: Explains the testing approach and how to run tests.

## Data Flow: From Flat Claims to Semantic URNs

A core task in the system is the deterministic generation of a canonical, semantic URN for an entity (like an Organization or an Employee) from the raw data provided during registration.

1.  **Input Data (Flat Claims):** The system receives all input data as a flat key-value map of `claims`. For identifiers and other nested structures, we use a flattened dot-notation convention.

    *Example Input Claims:*
    ```typescript
    const claims = {
      'org.schema.Organization.legalName': 'Acme Company',
      'org.schema.Organization.identifier.type': 'TAX',
      'org.schema.Organization.identifier.value': 'B12345678',
      'org.schema.Organization.address.addressCountry': 'ES',
      // ... other claims
    };
    ```

2.  **Manager's Role:** The responsible `Manager` (e.g., `CustomerManager`) receives these claims. Its primary role is to validate them and orchestrate the process.

3.  **URN Generation (Utility Function):** The `Manager` passes the entire `claims` object to a dedicated utility function (e.g., `createUrnFromClaims(claims)` located in `src/utils/urn.ts`).

4.  **Utility's Logic:** The utility function is responsible for extracting the required keys from the `claims` object (`identifier.type`, `identifier.value`, `address.addressCountry`, etc.) and using them to construct the canonical URN string according to the architecture defined in `VC_ARCHITECTURE.md`.

This approach ensures that:
- The logic for URN creation is centralized and easily testable.
- Managers remain lightweight and their dependencies are clear.
- The `claims` object remains the unaltered source of truth for the operation.

## Core Development Principles

To maintain a high-quality, secure, and maintainable codebase, all contributions **MUST** adhere to the following principles.

### 1. Strict Test-Driven Development (TDD) for Core Modules

When creating or modifying core modules (controllers, services, managers, models, adapters), a strict TDD workflow **MUST** be followed. This is non-negotiable for critical components like security services (`IKmsService`, `ICryptography`) and business logic managers.

The cycle is:
1.  **Write a Failing Test:** Write a concise test that defines the desired new feature or bug fix. The test should fail because the application code does not yet exist or is incorrect.
2.  **Write the Minimum Code:** Write the absolute minimum amount of application code required to make the test pass. Do not add extra features or refactor at this stage.
3.  **Refactor:** With the safety net of a passing test, refactor both the test code and the application code for clarity, efficiency, and adherence to coding standards.

### 2. Self-Explanatory Code and Tests

Code must be written to be as clear and understandable as possible to a new developer.

*   **No "Magic Strings":** Opaque values (strings, numbers) should be avoided.
*   **Use Descriptive Names:** Variables, functions, and classes should be named descriptively to reveal their intent.
*   **Create Helper Functions:** For complex or formatted strings (e.g., for service IDs, routes, or job names), helper functions **MUST** be created in the `src/utils` directory. This makes tests and application code more readable and less prone to errors. For example, instead of writing `"5-167...:host:..."`, use `createJobName('host', '...', '...')`.

The purpose of every part of a test's "Arrange" section should be immediately clear without needing to read the implementation details of the code being tested.

### 3. Testing Principles

All tests must follow the patterns and principles defined in our detailed **[Testing Patterns and Best Practices Guide (`src/docs/guides/testing-patterns.md`)](./docs/guides/testing-patterns.md)**. This is non-negotiable for ensuring a stable and maintainable codebase.
## API Interaction Examples

All write operations are asynchronous. You will receive a `202 Accepted` response with a `thid` (Transaction ID). You must then poll the `_search` endpoint with this `thid` to get the result.

### Organization Registration

**(curl examples will be added here once all tests are passing and the API is finalized)**

This example outlines the steps for registering a new organization, adhering to the FAPI and DIDComm security protocols. More detailed data structures and procedures are specified in [Organization Registration Process (`src/docs/organization_registration.md`).

### Employee Management in a Batch

**(curl examples will be added here once all tests are passing)**

This example will demonstrate how to manage employees using the `_batch` endpoint, leveraging the asynchronous processing and lean bundle structure.

---
## Running Tests

The project is configured to run unit and integration tests using Jest. The configuration is unified in `jest.config.ts`.

### Running All Tests

To run the complete test suite (both unit and integration tests):
```bash

npm run test
```

### Running Only Unit Tests

To run only the unit tests (files located in `src/__tests__/unit`):

```bash

npm run test:unit
```

### Running Only Integration Tests

To run only the integration tests (files located in `src/__tests__/integration`):
```bash

npm run test:integration
```

### Running a Specific Test File

To run a single test file, pass its path to the `npm test` command:

```bash
npm run test -- src/__tests__/unit/crypto/AesManager.test.ts