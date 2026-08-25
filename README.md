# Gateway Template - Node.js & TypeScript

([test-api](https://globaldatacare-test-961105121121.europe-southwest1.run.app/api-docs/))

This repository provides a robust, asynchronous, and policy-driven API gateway template.

It is designed for building secure, multi-tenant systems that handle complex data interactions, and integration with technologies like Financial API (FAPI), DIDComm, SMART-On-FHIR, and blockchain.

## Non-Negotiable Conventions

For the cross-repo 101 story order and security narrative, read
[NARRATIVE-ALIGNMENT.md](NARRATIVE-ALIGNMENT.md).

- FHIR SearchParameter names are canonical FHIR names only: lowercase and `-` where applicable.
- No invented camelCase for FHIR claims/search keys (example: use `Communication.part-of`, never `Communication.partOf`).
- Custom parameter names are allowed only when FHIR has no defined parameter.
- `resource.meta.claims` is the canonical project-specific claims carrier in a Bundle document (or JSON:API Primary document embedded in a DIDComm message) and must always be persisted/propagated.
- `resource.meta.claims` is not part of base FHIR. It is a claims-first extension used by GW/SDK contracts on top of FHIR-like resources.
- Those claims are often contextualized with `@context` such as `org.schema` or `org.hl7.fhir.api`, but may also use less-contextualized keys when the active `@context` already disambiguates them.

If you are new and confused by the front-story vs GW boundary, read first:

- [`gdc-common-utils-ts/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md`](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
- [`gdc-common-utils-ts/docs/101-COMMUNICATION_LAYERING.md`](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- [NARRATIVE-ALIGNMENT.md](NARRATIVE-ALIGNMENT.md)

GW starts after upstream profile/runtime unlock and document/Communication authoring.

## Repository Navigation

- Canonical local/GKE/live operations index:
  - local demo/runtime: [TESTING.md](TESTING.md)
  - deployment details and env split: [DEPLOY.md](DEPLOY.md)
  - API/docs index: [docs/README.md](docs/README.md)
  - current controller lifecycle contract: [docs-v2/18-organization-controller-lifecycle.md](docs-v2/18-organization-controller-lifecycle.md)
  - SDK live controller proof runner: [gdc-sdk-node-ts/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md)
- Fast path docs (recommended): [docs-v2/00-quickstart.md](docs-v2/00-quickstart.md)
- Key custody and audit posture: [docs-v2/19-key-custody-and-audit-readiness.md](docs-v2/19-key-custody-and-audit-readiness.md)
- Local audit/runtime with Fabric: [docs-v2/24-local-audit-fabric-runtime.md](docs-v2/24-local-audit-fabric-runtime.md)
- Reproducible open-source production-readiness evidence: [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md)
- Portal/BFF to GW CORE reference: [portal-api-gw.md](portal-api-gw.md)
- Internal project traceability and closeout status: [docs-internal/00-project-closeout-todo.md](docs-internal/00-project-closeout-todo.md)
- Environment-variable reference: [docs-v2/22-environment-variables-reference.md](docs-v2/22-environment-variables-reference.md)
- Testing and live E2E operations: [TESTING.md](TESTING.md)
- Core integration baseline and rationale: [docs/API_CORE_INTEGRATION.md](docs/API_CORE_INTEGRATION.md)
- Shared controller/device lifecycle note:
  [gdc-sdk-core-ts/docs/ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md)
- Main docs index: [docs/README.md](docs/README.md)
- Example-data and docs-sync guide: [docs/README.md#example-data-and-docs-sync](docs/README.md#example-data-and-docs-sync)
- Employee bundle/lifecycle contract reference: [gdc-sdk-core-ts/docs/101-EMPLOYEES.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-EMPLOYEES.md)
- SDK live local reference before running cross-repo E2E: [gdc-sdk-node-ts/docs/101-LIVE_GW_LOCAL.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-LIVE_GW_LOCAL.md)
- Repo roadmap: [TODO_ROADMAP.md](TODO_ROADMAP.md)
- Repo briefing: [docs/BRIEFING_DATASPACE_EN.md](docs/BRIEFING_DATASPACE_EN.md)
- Local environment template: [env.example](env.example)
- Local demo template: [env.local-demo.example](env.local-demo.example)
- Firestore demo template: [env.firestore-demo.example](env.firestore-demo.example)
- Local IPFS template: [env.local-ipfs.example](env.local-ipfs.example)
- Local PostgreSQL overrides template: [env.local-postgres.example](env.local-postgres.example)
- Cloud Supabase overrides template: [env.cloud-supabase.example](env.cloud-supabase.example)
- Local PostgreSQL container: [docker-compose.postgres.yml](docker-compose.postgres.yml)
- Local IPFS container: [docker-compose.ipfs.yml](docker-compose.ipfs.yml)

## Quick test

Minimal demo flow only (in-memory / demo mode).

For the canonical ICA + GW + SDK Node live verification workflow, including:

- local process from a real TTY
- local Docker against the built image
- staging checks
- the exact env vars that avoid ICA URL / jurisdiction / host-network mistakes

go first to [TESTING.md](TESTING.md).

## Canonical Operations

If you only need the current operational path, use these exact commands.

### 1. Build the local GW image

```bash
./docker_build_local.sh
```

This is the canonical local image build for this repo. It uses the workspace
root as Docker context and produces the local image `gwtemplate`.

### 2. Deploy the current GW to GKE

```bash
SKIP_BUILD=true ./cloud_deploy.sh gke gdc demo-deploy.config
```

Use this after `./docker_build_local.sh`.

This is the canonical GKE path in this repo:

- runtime app config comes from `.env.gke.gdc`
- cluster/image/static-IP config comes from `demo-deploy.config`
- `SKIP_BUILD=true` re-tags and pushes the already-built local image
  `gwtemplate`

Do not treat `cloud_deploy.sh staging` and `cloud_deploy.sh gke gdc` as
interchangeable:

- `cloud_deploy.sh staging` is the Cloud Run path and expects `.env.deploy.*`
- `cloud_deploy.sh gke gdc demo-deploy.config` is the GKE path and is the
  current canonical deploy path for this workspace

For the detailed split between Cloud Run, GKE, `.env.gke.gdc`, and
`demo-deploy.config`, see [DEPLOY.md](DEPLOY.md).

### 3. Prove controller lifecycle with VP bearer

From `gdc-sdk-node-ts`:

```bash
cd ../gdc-sdk-node-ts
npm run test:e2e:live-controller-lifecycle
```

That live runner:

- starts ICA + GW locally
- uses `TEST-A4-Antifraud.pdf` by default
- runs `Organization/_transaction`
- confirms the legal-organization order
- rebuilds a controller `vp_token`
- uses `Authorization: Bearer <vp_token>` for tenant `disable` and `purge`

For the exact runner contract, see:
- [gdc-sdk-node-ts/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md)

## 1) Clone repository

```bash
git clone <REPO_URL>
cd gwtemplate-node-ts
```

## 2) Install dependencies

```bash
npm install
```

## 3) Preparing the environment

Copy the file `env.local-demo.example` as `.env.local-demo`

```bash
cp env.local-demo.example .env.local-demo
```

## 4) Start backend in demo mode (Terminal 1)

Command:

```bash
npm run api:local-demo
```

## 5) Bootstrap tenant in GW (Terminal 2, once per tenant)

Command:

```bash
TENANT_ID=acme-id JURISDICTION=ES SECTOR=health-care HOST_NETWORK=test npm run demo:bootstrap-single-tenant
```

## 5.A) Docker local + Swagger family-registration flow

Build the local image:

```bash
./docker_build_local.sh
```

Run the container on a host port of your choice:

```bash
HOST_PORT=8080 FORCE_RECREATE=true ./docker_run_local.sh
```

Bootstrap the tenant against that Docker URL:

```bash
BASE_URL=http://localhost:8080 TENANT_ID=acme-id JURISDICTION=ES SECTOR=health-care HOST_NETWORK=test npm run demo:bootstrap-single-tenant
```

Naming rule:

- `SECTOR=health-care` is the tenant business sector
- `HOST_NETWORK=test` is the host runtime/network segment used under
  `/host/cds-{hostCoverageScope}/v1/{hostNetwork}/...`
- the host network must not be interpreted as the tenant business sector

Then open `http://localhost:8080/api-docs`, select `CORE`, and use the `Family Registration` request example named `Plaintext Message for Family Registration with online PDF link`.

Replace `{{signedIndividualFormPdfUrl}}` with:

```text
https://www.dropbox.com/scl/fi/gum7m1psy59jicisk6ke2/Prueba-fernando-Formulario_alta_servicio_indice_salud-firmado.pdf?rlkey=79s2dey287h4lx9568j4b5hl2&st=qbn7rx73&dl=1
```

That is the clean local repro path for the individual onboarding flow through Swagger. If you want the same flow from the Node SDK, it should be exercised from `gdc-sdk-client-ts` against the same `BASE_URL=http://localhost:<HOST_PORT>`.

## 5.B) GKE demo deployment from the repo root

The canonical GKE path is:

```bash
./docker_build_local.sh
SKIP_BUILD=true ./cloud_deploy.sh gke gdc demo-deploy.config
```

If you explicitly want the script to build and push in one step, the root
deploy entrypoint also supports GKE directly:

```bash
source demo-deploy.config
./cloud_deploy.sh gke-demo demo-deploy.config
```

That path:
- reuses `.env.local-demo` through `demo-deploy.config`
- keeps `DB_PROVIDER=mem` and `STORAGE_PROVIDER=mem`
- builds and pushes the GW image
- fetches GKE credentials
- applies the GW manifests behind a static-IP `LoadBalancer` Service

If the local image `gwtemplate` is already built and you want to avoid rebuilding it:

```bash
source demo-deploy.config
SKIP_BUILD=true LOCAL_IMAGE_NAME=gwtemplate ./cloud_deploy.sh gke-demo demo-deploy.config
```

The GKE demo deploy should always use an immutable image tag.
Do not keep `GDC_IMAGE` on mutable tags such as `:demo` or `:latest`.
Use a versioned tag such as `:1.6.1-8b0539b`.
If `GDC_IMAGE` still ends in `:demo` or `:latest`, `cloud_deploy.sh gke-demo` now rewrites it automatically to `<package-version>-<short-git-sha>`.
For the current demo path you do not need DNS or a domain. Use the public static IP directly in
`GDC_PUBLIC_URL`, for example `http://34.x.y.z`.

Recommended shortcut:

If you already ran `./docker_build_local.sh`, prefer the `SKIP_BUILD=true` variant above so the GKE demo deploy re-tags and pushes the existing local image instead of rebuilding it again.

## 6) Ingest medications via Communication and retrieve IPS search views (Terminal 2)

The shell script only orchestrates the flow. The synthetic demo payloads now live in TypeScript render helpers so the `.sh` does not duplicate FHIR/Communication contract JSON.
The canonical newbie story for document cases is:

- author a `Bundle` with `type=document`
- put `Composition` first in the bundle
- submit that document through `Communication` over DIDComm/plain
- read the attached document bundle back through `Communication`
- teach backend search separately with FHIR params such as `Composition.section`

Default mode (`didcomm`):

```bash
TENANT_ID=acme JURISDICTION=ES SECTOR=health-care npm run demo:communication-medications-ips
```

Legacy FHIR transport mode (`Content-Type: application/fhir+json`):

```bash
MODE=legacy-fhir TENANT_ID=acme JURISDICTION=ES SECTOR=health-care npm run demo:communication-medications-ips
```

With log file:

```bash
TENANT_ID=acme JURISDICTION=ES SECTOR=health-care npm run demo:communication-medications-ips:logged
```

Log files are written to:

```bash
logs/<YYYYMMDDHHMMSS>-communication-medications-ips.log
```

## Test-Driven Development (TDD)

This project follows a Test-Driven Development (TDD) approach. This means that tests are written *before* the code they are intended to verify. The TDD cycle consists of:

1.  **Write a Test (Red):** Start by writing a test case that *fails* because the code doesn't exist yet. This test case should specify the desired behavior of the component.
2.  **Implement the Code (Green):** Write the minimum amount of code necessary to make the test pass.
3.  **Refactor:** Once the test passes, refactor the code to improve its structure, readability, and maintainability, while ensuring that all tests still pass.
4.  **Repeat:** Repeat this cycle for each feature or functionality you want to add.

Following TDD helps to ensure that the code is well-tested, maintainable, and meets the specified requirements.

## Example Data And Docs Sync

Canonical payload examples are not maintained separately in Swagger, markdown, and tests.

- GW fixture source of truth: [`src/__tests__/data/example-payloads.ts`](src/__tests__/data/example-payloads.ts)
- Swagger/OpenAPI generation: [`src/utils/swagger-spec.ts`](src/utils/swagger-spec.ts) and [`scripts/generate-swagger-spec.mts`](scripts/generate-swagger-spec.mts)
- Script payload rendering from the same fixtures: [`scripts/render-example-payload.mts`](scripts/render-example-payload.mts)
- GW markdown conformance test: [`src/__tests__/unit/examples/markdown-examples.test.ts`](src/__tests__/unit/examples/markdown-examples.test.ts)
- Canonical document-bundle story check: [`src/__tests__/unit/api-examples/communication.examples.test.ts`](src/__tests__/unit/api-examples/communication.examples.test.ts)
- Canonical backend search check: [`src/__tests__/integration/composition.bundle-search.api.test.ts`](src/__tests__/integration/composition.bundle-search.api.test.ts)
- GW to shared `gdc-common-utils-ts` conformance test: [`src/__tests__/unit/examples/shared-flow-examples.test.ts`](src/__tests__/unit/examples/shared-flow-examples.test.ts)
- GW shared bundle editor surface contract: [`src/__tests__/unit/examples/shared-bundle-entry-editors.test.ts`](src/__tests__/unit/examples/shared-bundle-entry-editors.test.ts)
- Shared lifecycle source of truth: [`gdc-common-utils-ts/src/examples/lifecycle.ts`](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/examples/lifecycle.ts)
- Shared lifecycle guide "for torpes": [`gdc-common-utils-ts/docs/101-LIFECYCLE.md`](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-LIFECYCLE.md)
- GW lifecycle 101 for current local contract and SDK prompts: [`docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md`](docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md)
- GW shared bundle editor note for `asVitalSign()` vs generic Allergy/Medication/Condition editing: [`docs/01-OVERVIEW-AND-GUIDES/101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md`](docs/01-OVERVIEW-AND-GUIDES/101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md)
- GW canonical v2 clinical bundle reader contract: [`docs-v2/17-clinical-bundle-readers.md`](docs-v2/17-clinical-bundle-readers.md)
- GW deactivation/purge contract for auditors and integrators: [`docs-v2/16-deactivation-and-purge-lifecycle.md`](docs-v2/16-deactivation-and-purge-lifecycle.md)
- GW lifecycle current-vs-target note: [`docs/90.L-LIFECYCLE_CURRENT_VS_TARGET.md`](docs/90.L-LIFECYCLE_CURRENT_VS_TARGET.md)
- Shared lifecycle `101` guide: [`gdc-common-utils-ts/docs/101-LIFECYCLE.md`](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-LIFECYCLE.md)

Current rule:

- If a markdown example in `docs/90.A-API_INTEGRATORS_GUIDE.md` is canonical, mark it with `<!-- sync-example: EXAMPLE_NAME -->`.
- The markdown block must then match the exported payload from `example-payloads.ts` exactly.
- Demo/incremental flow scripts should render from `example-payloads.ts` and only apply explicit overrides for values such as tenant id, tax id, legal name, employee email, role, or subject id.
- If shared examples in `gdc-common-utils-ts` change, the GW conformance test must still pass.
- Lifecycle payloads must not be hardcoded independently in GW, SDK core, SDK node, SDK front, or Swagger once the shared package export is available locally.

Useful checks:

```bash
npm test -- --runTestsByPath src/__tests__/unit/examples/markdown-examples.test.ts src/__tests__/unit/examples/shared-flow-examples.test.ts src/__tests__/unit/utils/swagger-spec.test.ts
```

## Project Documentation

This project contains extensive documentation covering architecture, development practices, and API usage. All documentation is located in the `docs/` directory.

To get a full overview and navigate the documentation effectively, please start with the main index:

### **[➡️ Go to the Full Documentation Index (`docs/README.md`)](docs/README.md)**

## Quick Start

General development setup. This section is broader than Quick test.

Follow these steps to get your local development environment up and running.

### 1. Configure Your Local Environment

The server's configuration for local development is managed through explicit profile files such as `.env.local-demo`, `.env.local-postgres`, and `.env.cloud-supabase`. These files are **not** tracked in Git, ensuring your local settings and secrets are kept private.

First, copy the demo template file to create your local configuration (same file used in Quick test):
```bash
cp env.local-demo.example .env.local-demo
```

Next, open `.env.local-demo` and review its contents. For basic local development, the default values are often sufficient. The key variable for local testing is `DB_PROVIDER`, which is pre-configured to `mem` for an in-memory database, requiring no external setup.

If you want to run the vault against PostgreSQL locally, copy `env.local-postgres.example` to `.env.local-postgres`.

If you want PostgreSQL plus Supabase Storage, copy `env.cloud-supabase.example` to `.env.cloud-supabase`.

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

#### Option B: Using Node.js with Local PostgreSQL (Optional, not validated yet in this guide)

This method starts a dedicated local PostgreSQL container and runs the API with the full `.env.local-postgres` profile.

1. Start PostgreSQL:
```bash
npm run db:local-postgres:up
```

2. Create your private overrides file:
```bash
cp env.local-postgres.example .env.local-postgres
```

3. Run the API with PostgreSQL:
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

#### Option B1: Using Node.js with Local PostgreSQL + Supabase Storage

This method keeps the confidential vault in PostgreSQL and stores uploaded files in Supabase Storage.

1. Start PostgreSQL:
```bash
npm run db:local-postgres:up
```

2. Create your private Supabase overrides file:
```bash
cp env.cloud-supabase.example .env.cloud-supabase
```

3. Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` in `.env.cloud-supabase`.

4. Run the API with Supabase Storage:
```bash
npm run api:cloud-supabase
```

Notes:
- `POSTGRES_*` should point at your Supabase/PostgreSQL database if you are not using the local container.
- `SUPABASE_STORAGE_PUBLIC=true` is the expected mode for this adapter because the current storage contract persists stable `publicUrl` values.

#### Option B2: Using Node.js with Firestore Demo

This method keeps demo mode (`NODE_ENV=demo`) but persists confidential storage in Firestore and files in GCS.

1. Create your local profile:
```bash
cp env.firestore-demo.example .env.firestore-demo
```

2. Fill `FIRESTORE_PROJECT_ID`, `GCS_BUCKET_NAME`, and `GOOGLE_APPLICATION_CREDENTIALS`.

3. Run the API:
```bash
npm run api:local-firestore-demo
```

#### Option B3: Using Node.js with PostgreSQL + IPFS (open-source profile)

This method keeps demo mode (`NODE_ENV=demo`) while persisting vault metadata in
PostgreSQL and confidential blobs in a local Kubo node.

1. Start the local dependencies:
```bash
npm run db:local-postgres:up
npm run ipfs:local:up
```

2. Create your local profile:
```bash
cp env.local-ipfs.example .env.local-ipfs
```

3. Run the API:
```bash
npm run api:local-ipfs
```

#### Option C: Using Docker

This method runs the application inside a Docker container, which is a great way to ensure a consistent environment. This is the same image that will be deployed to the cloud.

1.  **Build the Docker image:**
    *(This script uses the `NPM_TOKEN` from the first available local profile file: `.env.local-demo`, `.env.local-postgres`, or `.env.cloud-supabase`)*
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
- `npm run test:e2e:real`: Run E2E with real Google auth precheck. If login is missing, it stops and asks for `gcloud auth login`, then you rerun.
- `npm run seed:dev`: Generate deterministic dev CA material (used by Fabric CA containers).

## E2E Auth Modes (Do Not Mix)

- Simulated/local tests:
  - Unit/integration and many E2E checks can run with mocks or local providers.
  - Useful for deterministic CI and fast feedback.
- Real auth E2E:
  - Validates real token verification path.
  - Requires active `gcloud` login and a real `id_token`.
  - Use `npm run test:e2e:real`.
  - If auth is missing, command exits with instructions. After login, rerun the same command.

## Portal Web (apptemplate) - What Must Work in GW

To validate `gdc-sdk-client-ts` from `apptemplate` (web portal), keep `gwtemplate-node-ts` focused on the current portal flows: tenant organization activation from signed proof, individual indexing in the hosted tenant, consent, SMART, and identity paths.

### Cross-SDK integration index (GW + frontend + node)

Use this order to avoid drift between implementations:

1. GW readiness and route compatibility:
   - [docs/05-USE-CASES/PORTAL_WEB_GO_NO_GO_CHECKLIST.md](docs/05-USE-CASES/PORTAL_WEB_GO_NO_GO_CHECKLIST.md)
2. Frontend SDK use cases and exact calls (`gdc-sdk-client-ts`):
   - [gdc-sdk-client-ts/docs/DEVELOPER_USE_CASES.md](https://github.com/Global-DataCare/gdc-sdk-client-ts/blob/main/docs/DEVELOPER_USE_CASES.md)
3. Backend Node SDK use cases and exact calls (`dataspace-client-sdk-node`):
   - [dataspace-client-sdk-node/docs/DEVELOPER_USE_CASES.md](https://github.com/Global-DataCare/dataspace-client-sdk-node/blob/main/docs/DEVELOPER_USE_CASES.md)

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

The list below mixes current portal routes and legacy compatibility routes. The canonical legal-organization onboarding flow starts with `/_transaction` for verification forwarding to ICA `_verify`, and that flow is complete without requiring `/_activate` as a follow-up step. `Organization/_activate` remains published only as a legacy compatibility route for callers that already start from an ICA-issued proof. The older `Organization/_batch` / `Order/_batch` family remains only for backward compatibility and portal regression checks.
Compatibility aliases are also enabled for older callers: `Organization/_verify` behaves as `Organization/_batch`, and `Organization/_verify-response` behaves as `Organization/_batch-response`.

Minimum backend routes required for portal tests (current gwtemplate):

1. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction`
2. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response`
3. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate` (legacy compatibility for ICA-proof-first callers)
4. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response` (legacy compatibility)
5. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch` (legacy compatibility)
6. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response` (legacy compatibility)
7. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch` (legacy compatibility)
8. `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response` (legacy compatibility)
9. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch`
10. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch-response`
11. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange`
12. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response`
13. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr`
14. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response`
15. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token`
16. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response`
17. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch` (legacy compatibility)
18. `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response` (legacy compatibility)

Recommended local preparation sequence:

1. Start GW in local demo mode.
2. Start ICA/local dependencies when needed.
3. Bootstrap tenant/controller only for legacy or regression validation:
   - `cd ../dataspace-client-sdk-node`
   - `npm run example:e2e-bootstrap-tenant` (with `VP_TOKEN` and envs)
4. Run `apptemplate` web with the selected profile.

Before opening `apptemplate`, run the 5-minute Go/No-Go checklist:

- [docs/05-USE-CASES/PORTAL_WEB_GO_NO_GO_CHECKLIST.md](docs/05-USE-CASES/PORTAL_WEB_GO_NO_GO_CHECKLIST.md)

Automated check command:

```bash
npm run check:portal-web-go-no-go
```

This command is a route smoke check. It renders canonical GW example fixtures and verifies that the portal-facing routes exist and accept the expected payload shapes; it is not a replacement for the full flow runner or live E2E validation.

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

Transport note:

- This section documents inbound HTTP compatibility and envelope handling for
  GW CORE operators.
- It is not the recommended app-integration teaching surface for onboarding,
  controller recovery, or device lifecycle.
- Product integrations should follow the actor-scoped SDK lifecycles in
  `gdc-sdk-node-ts` / `gdc-sdk-front-ts`; these flags only explain what the GW
  host accepts on the wire.

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
- `DIDCOMM_PLAIN=true|false|enabled|disabled`: allows `application/didcomm-plain+json` in `compat`.
- `DEMO_ALLOW_INSECURE_BEARER=true|false`: in `demo`, allows invalid/unverified bearer tokens in API routes.
- `GW_REQUEST_BODY_LIMIT=<bytes|kb|mb|gb>`: request body size limit shared by `express.json()` and `express.urlencoded()`. Default: `25mb`.

Why `GW_REQUEST_BODY_LIMIT` matters:

- Communication ingestion can embed large DIDComm/FHIR payloads, including IPS bundles and base64 attachments.
- Express defaults to about `100kb`, which is too small for realistic clinical payloads.
- The same global parser is used before routing, so both `.../org.hl7.fhir.r4/Communication/_batch` and `.../org.hl7.fhir.api/Communication/_batch` fail in the same way when the request body exceeds the configured limit.

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
- `../fabric-multicloud/devnet/fabric-v3/README.md`
- local audit/operator profile in this repo: `docs-v2/24-local-audit-fabric-runtime.md`

Before a local-network image smoke, verify that its packaged organization/key
chaincode mirror matches the canonical CCAAS source in `fabric-multicloud`:

```bash
npm run check:identity-chaincode-parity
```

For the multi-cloud Fabric deployment plan and scripts, see:
- `../fabric-multicloud/README.md`
- `docs/04-DEEP-DIVES/04.I-FABRIC-MULTICLOUD-BLUEPRINT.md`

Local (minikube/k3s) is test-only and documented in:
- `private-deploy.local.config`

## Roadmap and Briefing
- `docs/BRIEFING_DATASPACE_EN.md`
- `TODO_ROADMAP.md`

## Pending Compatibility TODO
- See [SMART EHR compatibility TODO](docs/TODO_SMART_EHR_COMPAT.md).
- See [Tenant identifier and vault migration TODO (v2.0)](docs/90.K-TODO_TENANT_IDENTIFIER_V2.md).

## Local Single-Tenant Bootstrap (acme-id)
Run this when you need tenant `acme-id` ready for activation, employee, consent, and FHIR flows:

```bash
TENANT_ID=acme-id JURISDICTION=ES SECTOR=health-care HOST_REGISTRY_SECTOR=test npm run demo:bootstrap-single-tenant
```

Notes:
- This registers/ensures tenant `acme-id` via host registry Offer/Order flow.
- With the default values of this script (`TENANT_ID=acme-id`, `ADMIN_EMAIL=admin1@acme.org`, etc.), `EMPLOYEE_COUNT=2` leaves one additional employee seat after bootstrap because the controller/admin consumes the first one.
- Use `EMPLOYEE_COUNT=3` only when you want to run the local two-employee lifecycle smoke after bootstrap (`create employee 1`, `create employee 2`, `disable employee 2`, `purge both`).
- In `v1.x`, legal-organization bootstrap sends `Organization.identifier.value` (`taxId`) as the canonical external identifier.
- `alternateName` is reserved for individual/family-style onboarding examples. For legal organizations, GW CORE currently derives its internal compatibility alias from `taxId` when omitted.
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
