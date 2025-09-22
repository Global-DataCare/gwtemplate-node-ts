# Gateway Template - Node.js & TypeScript

This repository provides a robust, asynchronous, and policy-driven API gateway template. It is designed for building secure, multi-tenant systems that handle complex data interactions, and integration with technologies like Financial API (FAPI), DIDComm and blockchain.

## Test-Driven Development (TDD)

This project follows a Test-Driven Development (TDD) approach. This means that tests are written *before* the code they are intended to verify. The TDD cycle consists of:

1.  **Write a Test (Red):** Start by writing a test case that *fails* because the code doesn't exist yet. This test case should specify the desired behavior of the component.
2.  **Implement the Code (Green):** Write the minimum amount of code necessary to make the test pass.
3.  **Refactor (Refactor):** Once the test passes, refactor the code to improve its structure, readability, and maintainability, while ensuring that all tests still pass.
4.  **Repeat:** Repeat this cycle for each feature or functionality you want to add.

Following TDD helps to ensure that the code is well-tested, maintainable, and meets the specified requirements.

## Project Documentation

This project's documentation is split into several key files. Start here to understand the architecture, development patterns, and testing strategies.

1.  **[Setup and Configuration Guide (`SETUP_GUIDE.md`)](SETUP_GUIDE.md)**
    This document explains how to configure the necessary environment variables for the service to run, especially for the initial `host` setup. **Start here.**
2.  **[Architecture Patterns (`ARCHITECTURE_PATTERNS.md`)](ARCHITECTURE_PATTERNS.md)**
    This is the **most important document**. It is the single source of truth for the core architectural decisions, data flows, and API structure. It serves as a formal specification and a "prompt" for any AI-assisted development to ensure consistency. **Read this first.**

3.  **[New Storage Architecture Plan (`NEW_STORAGE_ARCH.md`)](NEW_STORAGE_ARCH.md)**
    This document outlines the plan to refactor the storage layer towards a unified Repository pattern. It details the future structure for database interactions, ensuring a clean separation of concerns.

4.  **[Developer Guide (`DEVELOPER_GUIDE.md`)](DEVELOPER_GUIDE.md)**
    This guide provides practical instructions for developers, including setup, running the server, and examples of how to interact with the API using `curl`.

5.  **[Organization Registration Process (`src/docs/organization_registration.md`)](src/docs/organization_registration.md)**
    This document details the process for registering new organizations (tenants) within the system, covering data flow, component responsibilities, security considerations (FAPI, DIDComm), and data structures. It also serves as a prompt for developers and AI code generation related to the registration process.

6.  **[Testing Strategy (`src/__tests__/README.md`)](src/__tests__/README.md)**
    This document explains the testing philosophy, the structure of the integration tests, and how to add new test cases.

## Quick Start

1.  Install dependencies:

    ```bash
    npm install
    ```

2.  Run the development server:

    ```bash
    npm run dev
    ```

3.  Run tests:

    ```bash
    npm test
    ```