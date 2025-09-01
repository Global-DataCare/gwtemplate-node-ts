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

Before using the API, it is **essential** to read and understand the core architectural principles:

*   **[Architecture Patterns (`ARCHITECTURE_PATTERNS.md`)](ARCHITECTURE_PATTERNS.md)**: This document explains the asynchronous FAPI flow, data models, and key architectural decisions.
*   **[Organization Registration Process (`src/docs/organization_registration.md`)](src/docs/organization_registration.md)**: Details the process of registering new organizations (tenants) within the system.
*   **[Testing Strategy (`src/__tests__/README.md`)](src/__tests__/README.md)**: Explains the testing approach and how to run tests.

## API Interaction Examples

All write operations are asynchronous. You will receive a `202 Accepted` response with a `thid` (Transaction ID). You must then poll the `_search` endpoint with this `thid` to get the result.

### Organization Registration

**(curl examples will be added here once all tests are passing and the API is finalized)**

This example outlines the steps for registering a new organization, adhering to the FAPI and DIDComm security protocols. More detailed data structures and procedures are specified in [Organization Registration Process (`src/docs/organization_registration.md`).

### Employee Management in a Batch

**(curl examples will be added here once all tests are passing)**

This example will demonstrate how to manage employees using the `_batch` endpoint, leveraging the asynchronous processing and lean bundle structure.

---