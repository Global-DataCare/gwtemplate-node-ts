# Gateway Template - Node.js & TypeScript

([test-api](https://globaldatacare-test-961105121121.europe-southwest1.run.app/api-docs/))

This repository provides a robust, asynchronous, and policy-driven API gateway template.

It is designed for building secure, multi-tenant systems that handle complex data interactions, and integration with technologies like Financial API (FAPI), DIDComm and blockchain.

## Test-Driven Development (TDD)

This project follows a Test-Driven Development (TDD) approach. This means that tests are written *before* the code they are intended to verify. The TDD cycle consists of:

1.  **Write a Test (Red):** Start by writing a test case that *fails* because the code doesn't exist yet. This test case should specify the desired behavior of the component.
2.  **Implement the Code (Green):** Write the minimum amount of code necessary to make the test pass.
3.  **Refactor:** Once the test passes, refactor the code to improve its structure, readability, and maintainability, while ensuring that all tests still pass.
4.  **Repeat:** Repeat this cycle for each feature or functionality you want to add.

Following TDD helps to ensure that the code is well-tested, maintainable, and meets the specified requirements.

## Project Documentation

This project contains extensive documentation covering architecture, development practices, and API usage. All documentation is located in the `docs/` directory.

To get a full overview and navigate the documentation effectively, please start with the main index:

### **[➡️ Go to the Full Documentation Index (`docs/README.md`)](docs/README.md)**

## Quick Start

Follow these steps to get your local development environment up and running.

### 1. Configure Your Local Environment

The server's configuration for local development is managed through a `.env.local` file. This file is **not** tracked in Git, ensuring your local settings and secrets are kept private.

First, copy the template file to create your local configuration:
```bash
cp env.example .env.local
```

Next, open `.env.local` and review its contents. For basic local development, the default values are often sufficient. The key variable for local testing is `DB_PROVIDER`, which is pre-configured to `mem` for an in-memory database, requiring no external setup.

### 2. Install Dependencies

Install the necessary Node.js packages:
```bash
npm install
```

### 3. Run the Application

You have two main options for running the application locally:

#### Option A: Using Node.js (Recommended for Development)

This method runs the server directly using `ts-node` and provides hot-reloading, which automatically restarts the server when you make code changes.
```bash
npm run dev
```
The server will be available at `http://localhost:3000`.

#### Option B: Using Docker

This method runs the application inside a Docker container, which is a great way to ensure a consistent environment. This is the same image that will be deployed to the cloud.

1.  **Build the Docker image:**
    *(This script uses the `NPM_TOKEN` from your `.env.local` file if it exists)*
    ```bash
    ./docker_build_local.sh
    ```
    Notes:
    - It automatically uses `--no-cache` when `package.json` or `package-lock.json` changes.
    - You can force it with `./docker_build_local.sh --no-cache` (or `-n`).

2.  **Run the container:**
    *(This script maps port 8080 on your host to port 3000 in the container)*
    ```bash
    ./docker_run_local.sh
    ```
The server will be available at `http://localhost:8080`.

### 4. Run Tests

To ensure everything is working correctly, run the test suite:
```bash
npm test
```
For test tiers and E2E setup details, see:
- `TESTING.md`
- `TESTING-GUIDE.md`

## Next Steps: Exploring the API

Once the development server is running (via `npm run dev`), you can explore and interact with the API in two primary ways:

### 1. Interactive API Documentation (Swagger)

The server provides a live, interactive Swagger UI that documents all available endpoints. This is the easiest way to understand the API and send test requests directly from your browser.

*   **URL**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

### 2. cURL Examples

For more advanced testing and scripting, the project includes a comprehensive collection of `curl` commands. These are useful for simulating client requests from the command line and are essential for understanding the data structures.

*   **Location**: You can find these examples in the [cURL Tests Documentation](docs/02-API-AND-ENDPOINTS/02.C-CURL-TESTS.md).

## Useful Commands

- `npm run dev`: Run the server locally with hot reload and regenerate `swagger-spec.json`.
- `npm run build:swagger`: Generate `swagger-spec.json` (served by `/api-docs`).
- `npm run docs:flow-report`: Run the onboarding journey against the in-memory app and write `artifacts/api-integrators-guide.flow-report.json` (docs QA).
- `npm test`: Run the full test suite.
- `npm run test:unit` / `npm run test:integration` / `npm run test:e2e`: Run specific test tiers.
- `npm run seed:dev`: Generate deterministic dev CA material (used by Fabric CA containers).

## Fabric Devnet (Optional)

For a deterministic Fabric v3 devnet (DEMO single-host or multi-org), see:
- `devnet/fabric-v3/README.md`
