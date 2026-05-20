# Gateway Template - Node.js & TypeScript

([test-api](https://globaldatacare-test-961105121121.europe-southwest1.run.app/api-docs/))

This repository provides a robust, asynchronous, and policy-driven API gateway template.

It is designed for building secure, multi-tenant systems that handle complex data interactions, and integration with technologies like Financial API (FAPI), DIDComm and blockchain.

## Non-Negotiable Conventions

- FHIR SearchParameter names are canonical FHIR names only: lowercase and `-` where applicable.
- No invented camelCase for FHIR claims/search keys (example: use `Communication.part-of`, never `Communication.partOf`).
- Custom parameter names are allowed only when FHIR has no defined parameter.
- `resource.meta.claims` is the canonical interoperable claims carrier and must always be persisted/propagated.

## Repository Navigation

- Fast path docs (recommended): [docs-v2/00-quickstart.md](docs-v2/00-quickstart.md)
- Main docs index: [docs/README.md](docs/README.md)
- Repo roadmap: [TODO_ROADMAP.md](TODO_ROADMAP.md)
- Repo briefing: [BRIEFING_DATASPACE_EN.md](BRIEFING_DATASPACE_EN.md)
- Local environment template: [env.example](env.example)
- Local PostgreSQL overrides: [.env.local.postgres](.env.local.postgres)
- Local PostgreSQL container: [docker-compose.postgres.yml](docker-compose.postgres.yml)

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

If you want to run the vault against PostgreSQL locally, keep `.env.local` as your base file and use the overrides in `.env.local.postgres`.

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

#### Option B: Using Node.js with Local PostgreSQL

This method starts a dedicated local PostgreSQL container and runs the API with `.env.local.postgres` layered on top of `.env.local`.

1. Start PostgreSQL:
```bash
npm run db:local-postgres:up
```

2. Run the API with PostgreSQL:
```bash
npm run api:local-postgres
```

Useful helpers:
```bash
npm run db:local-postgres:logs
npm run db:local-postgres:reset
npm run db:local-postgres:down
```

The vault schema is created automatically by the API on startup.

#### Option C: Using Docker

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

## Portal Web (apptemplate) - What Must Work in GW

To validate `gdc-sdk-client-ts` from `apptemplate` (web portal), keep `gwtemplate-node-ts` focused on the current portal flows: tenant organization activation from signed proof, individual indexing in the hosted tenant, consent, SMART, and identity paths.

### Cross-SDK integration index (GW + frontend + node)

Use this order to avoid drift between implementations:

1. GW readiness and route compatibility:
   - [docs/scenarios/PORTAL_WEB_GO_NO_GO_CHECKLIST.md](docs/scenarios/PORTAL_WEB_GO_NO_GO_CHECKLIST.md)
2. Frontend SDK use cases and exact calls (`gdc-sdk-client-ts`):
   - [../gdc-sdk-client-ts/docs/DEVELOPER_USE_CASES.md](../gdc-sdk-client-ts/docs/DEVELOPER_USE_CASES.md)
3. Backend Node SDK use cases and exact calls (`dataspace-client-sdk-node`):
   - [../dataspace-client-sdk-node/docs/DEVELOPER_USE_CASES.md](../dataspace-client-sdk-node/docs/DEVELOPER_USE_CASES.md)

Flow contract to keep aligned:

- Client SDKs call GW only (never ICA directly).
- UC5.6 stays decoupled in demos and production:
  1. Consent submission (`Consent/_batch`).
  2. SMART token request by professional app.
- Legacy family/onboarding routes remain available only for backward compatibility; new portal docs should use the tenant organization activation + individual indexing flow.

Integration boundary (mandatory):

- Frontend SDK and backend client SDK must call GW routes only.
- SDKs must not call ICA directly.
- GW is the orchestration gateway: it receives DidComm bundles, validates claims/attachments, calls ICA and any external verification services internally, and returns Offer/Order activation outcomes asynchronously.

Current status (important):

- `dataspace-client-sdk-node` identity helpers target unified routes:
  - `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/...`
- `gwtemplate-node-ts` keeps legacy runtime routes:
  - `/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/...`
- `gwtemplate-node-ts` now accepts both patterns for identity auth (new unified + legacy) and normalizes internally.

The list below mixes current portal routes and legacy compatibility routes. The current canonical path is `/_activate` for tenant organization onboarding from signed proof; the older `Organization/_batch` / `Order/_batch` family remains only for backward compatibility and portal regression checks.
Compatibility aliases are also enabled for older callers: `Organization/_verify` behaves as `Organization/_batch`, and `Organization/_verify-response` behaves as `Organization/_batch-response`.

Minimum backend routes required for portal tests (current gwtemplate):

1. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
2. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response`
3. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch` (legacy compatibility)
4. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response` (legacy compatibility)
5. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch` (legacy compatibility)
6. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response` (legacy compatibility)
7. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch`
8. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch-response`
9. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange`
10. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response`
11. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr`
12. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response`
13. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token`
14. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response`
15. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch` (legacy compatibility)
16. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response` (legacy compatibility)

Recommended local preparation sequence:

1. Start GW in local demo mode.
2. Start ICA/local dependencies when needed.
3. Bootstrap tenant/controller only for legacy or regression validation:
   - `cd ../dataspace-client-sdk-node`
   - `npm run example:e2e-bootstrap-tenant` (with `VP_TOKEN` and envs)
4. Run `apptemplate` web with the selected profile.

Before opening `apptemplate`, run the 5-minute Go/No-Go checklist:

- [docs/scenarios/PORTAL_WEB_GO_NO_GO_CHECKLIST.md](docs/scenarios/PORTAL_WEB_GO_NO_GO_CHECKLIST.md)

Automated check command:

```bash
npm run check:portal-web-go-no-go
```

## API Integrators Flow Runner

Use this runner to validate the journey documented in `docs/API_INTEGRATORS_GUIDE.md` against the current code:

- Command: `npm run docs:flow-report`
- Output: `artifacts/api-integrators-guide.flow-report.json`
- Scope:
  - Host discovery + organization onboarding (Offer/Order)
  - ICA status message checks for legal representative (`messaging/_messages` and `messaging/_get`)
  - Initial access token, DCR, SMART token, employee, consent, communication, composition

Notes:
- The report includes both expected success and intentional negative-path checks.
- ICA automatic message persistence requires ICA connectivity (`ICA_EXTERNAL_DOMAIN` + reachable ICA endpoint). If not configured, the runner records the ICA message fetch step as informational (`204`) instead of failing the full report.

## PKI generation (CA / ICA / Host / Member)

This project includes scripts to generate a deterministic PKI chain from schema.org
`Organization` JSON files. Each step is separated so CA/ICA are created once and
hosts/members can be generated as needed.

Required JSON fields:
- `legalName` (original legal name; can be non-ASCII)
- `name` (ICAO9303 transliteration in ASCII)
- `alternateName` (optional commercial name)
- `taxID`
- `url` (used to derive domain)
- `address.addressCountry` (ISO-2 country code)

Optional:
- `address.addressLocality`, `address.streetAddress`, `address.postalCode`

Example inputs live in `pki-inputs/test` and `pki-inputs/prod`.

Commands (run from repo root):

```bash
# Root CA
npm run pki:root -- --json pki-inputs/test/ca-organization.json --env test

# Intermediate CA (signed by Root CA)
npm run pki:ica -- \
  --json pki-inputs/test/ica-organization.json \
  --ca-json pki-inputs/test/ca-organization.json \
  --ca-dir artifacts/test/pki-root-ca \
  --env test

# Host certificate (signed by ICA)
npm run pki:host -- \
  --json pki-inputs/test/host-organization.json \
  --ica-json pki-inputs/test/ica-organization.json \
  --ica-dir artifacts/test/pki-ica/<ICA_MSP_ID> \
  --ca-dir artifacts/test/pki-root-ca \
  --env test

# Member certificate (signed by ICA)
npm run pki:member -- \
  --json pki-inputs/test/member-organization.json \
  --ica-json pki-inputs/test/ica-organization.json \
  --ica-dir artifacts/test/pki-ica/<ICA_MSP_ID> \
  --ca-dir artifacts/test/pki-root-ca \
  --env test
```

Seeds can be passed with `--seed <hex>` or entered interactively.
Environment output defaults to `test` and writes under `artifacts/<env>/`.
If the target output directory already exists, the script will prompt before overwriting.
Key derivation (KDF) defaults to:
- `auto`: if the seed is a 32-byte hex string, it is used directly; otherwise scrypt is used.
- `scrypt`: always use scrypt.
- `hash`: legacy mode (hash-only).
- `context`: derives context-specific keys via `scrypt + HKDF` (recommended for multi-ecosystem keys).

You can force the mode and override scrypt params:

```bash
npm run pki:member -- --json pki-inputs/test/member-organization.json \
  --ica-json pki-inputs/test/ica-organization.json \
  --ica-dir artifacts/test/pki-ica \
  --ca-dir artifacts/test/pki-root-ca \
  --env test \
  --kdf scrypt \
  --kdf-config pki-kdf.json
```

Context KDF example (multi-ecosystem):

```bash
npm run pki:member -- --json pki-inputs/test/member-organization.json \
  --ica-json pki-inputs/test/ica-organization.json \
  --ica-dir artifacts/test/pki-ica \
  --ca-dir artifacts/test/pki-root-ca \
  --env test \
  --kdf context \
  --context fabric \
  --kdf-config pki-kdf.json
```

Leaf certificates are named with:
- `HOST_<country>_TAX_<taxId>.pem` for hosts
- `MEMBER_<country>_TAX_<taxId>.pem` for members

## Fabric Devnet (Optional)

## Security Modes

`SECURITY_MODE` and `NETWORK_MODE` are independent controls:
- `SECURITY_MODE`: inbound content/auth policy (`strict|compat|demo`).
- `NETWORK_MODE`: host-registry and ledger environment (`test|test-network|network`).

If `NETWORK_MODE` is unset, GW falls back to `NODE_ENV` mapping:
- `production` -> `network`
- `development|staging` -> `test-network`
- otherwise -> `test`


GW supports a unified inbound security policy controlled by `SECURITY_MODE`:

- `strict`: only secure form-encoded requests (`application/x-www-form-urlencoded` with `request=<jwe>`).
- `compat`: secure requests plus optional legacy types enabled by flags.
- `demo`: plaintext/demo behavior for local testing only.

Compatibility flags:

- `FHIR_LEGACY=true|false`: allows `application/fhir+json` in `compat`.
- `JSON_LEGACY=true|false`: allows `application/json` in `compat`.
- `DIDCOMM_PLAIN=true|false|enabled|disabled`: allows `application/didcomm-plaintext+json` in `compat`.
- `DEMO_ALLOW_INSECURE_BEARER=true|false`: in `demo`, allows invalid/unverified bearer tokens in API routes.

Guardrail:

- `SECURITY_MODE=demo` is blocked when `NODE_ENV=production`.

Recommended staging profile:

```bash
SECURITY_MODE=compat
FHIR_LEGACY=true
JSON_LEGACY=true
DIDCOMM_PLAIN=disabled
DEMO_ALLOW_INSECURE_BEARER=false
```

For a deterministic Fabric v3 devnet (DEMO single-host or multi-org), see:
- `devnet/fabric-v3/README.md`

For the multi-cloud Fabric deployment plan and scripts, see:
- `fabric-multicloud/README.md`
- `docs/04-DEEP-DIVES/04.I-FABRIC-MULTICLOUD-BLUEPRINT.md`

Local (minikube/k3s) is test-only and documented in:
- `private-deploy.local.config`

## Roadmap and Briefing
- `BRIEFING_DATASPACE_EN.md`
- `TODO_ROADMAP.md`

## Pending Compatibility TODO
- See [SMART EHR compatibility TODO](docs/TODO_SMART_EHR_COMPAT.md).

## Local Single-Tenant Bootstrap (acme)
Run this before chat/voice E2E when you need a business tenant ready for activation, employee, consent, and FHIR flows:

```bash
TENANT_ID=acme JURISDICTION=ES SECTOR=health-care HOST_REGISTRY_SECTOR=test npm run demo:bootstrap-single-tenant
```

Notes:
- This registers/ensures tenant `acme` via host registry Offer/Order flow.
- `host` is reserved for platform-level routes and well-known endpoints.

### Compatibility Matrix: Legacy/Plaintext Support

| SECURITY_MODE | FHIR_LEGACY / JSON_LEGACY | DIDCOMM_PLAIN                    | DEMO_ALLOW_INSECURE_BEARER |
|--------------|---------------------------|-----------------------------------|----------------------------|
| strict       | ❌                        | Only if `DIDCOMM_PLAIN=true`      | ❌                         |
| compat       | Only if `=true`           | Only if `=true`                   | ❌                         |
| demo         | Always allowed            | Always allowed                    | Only if `=true`            |

- In `strict`, didcomm-plain is only allowed if you set `DIDCOMM_PLAIN=true`.
- In `compat`, you can enable legacy and didcomm-plain with the corresponding variables.
- In `demo`, all legacy and plaintext types are allowed by default.
- In production, `SECURITY_MODE=demo` is blocked.

> **Note:** If you are unsure which modes are active, check the startup log: it will show the enabled capabilities (`didcomm-encrypted`, `didcomm-plain`, etc).
