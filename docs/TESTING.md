# Testing Guide

This document outlines the testing strategies and procedures for this project.
For E2E setup and GCP details, see `TESTING-E2E.md`.

## 1. Core Philosophy: The `IVaultRepository` Pattern

The application abstracts its confidential storage layer using the `IVaultRepository` interface (`src/database/repositories/vault/vault.repository.ts`). This allows the underlying database technology to be swapped without changing business logic.

The specific repository implementation is chosen at runtime based on the `VAULT_PROVIDER` environment variable.

-   **`mem`**: (Default) Uses `VaultMemRepository`, a fast, volatile, in-memory implementation ideal for most unit and integration tests.
-   **`firestore`**: Uses `FirestoreVaultRepository`, the production-grade implementation for Google Cloud Firestore.
-   **`mongo`**: (Future) A MongoDB implementation could be added here.

## 2. Jest Configuration

The project uses Jest as its test runner, configured via `jest.config.ts`. A key part of the configuration is the `jest.setup.ts` file, which is executed before any test suite runs.

This setup file is responsible for loading the correct environment variables based on the test script being executed. The canonical local profile is `.env.local-demo`, with an optional `JEST_ENV_FILE` override for explicit E2E variants.

Note on ESM dependencies: some packages (e.g. `gdc-common-utils-ts`, `gdc-sdk-client-ts`) ship ESM TypeScript sources. Tests run with `NODE_OPTIONS=--experimental-vm-modules`, and `ts-jest` is configured to transform those packages from `node_modules`.

## 3. Running Tests

-   **Unit & Fast Integration Tests:**
    ```shell
    npm test
    ```
    This command runs all tests that do not require external services. It primarily uses the `VaultMemRepository`.

-   **Firestore-Specific Tests:**
    Testing against Firestore requires a specific setup, either with a local emulator or a live GCP project. See the
    **[E2E testing guide](TESTING-E2E.md)**.

-   **E2E Tests (explicit opt-in):**
    E2E suites that touch external services are disabled by default. To run them, set the flags below (typically in your shell before running `npm run test:e2e`):
    ```shell
    # Firestore E2E (requires emulator or valid credentials)
    FIRESTORE_E2E=true

    # GCS E2E (requires valid credentials + bucket)
    GCS_E2E=true

    # IPFS E2E (requires local Kubo node)
    IPFS_E2E=true

    # Legacy API E2E (requires a real Firebase Auth user)
    TEST_USER_EMAIL=you@example.com
    TEST_USER_PASSWORD=your-password
    ```
    Notes:
    - E2E tests read from `.env.local-demo` by default via `jest.setup.ts`.
    - If you need a different profile, set `JEST_ENV_FILE=<filename>` before running the E2E suite.
    - Firestore E2E runs only when `FIRESTORE_E2E=true` and either `FIRESTORE_EMULATOR_HOST` or valid Google credentials are present.
    - GCS E2E runs only when `GCS_E2E=true` and `GCS_BUCKET_NAME` is set.
    - The open-source acceptance profile is `npm run docker:smoke:open-source-local-network`.
      It runs the exact GW image with Fabric `local-network`, PostgreSQL and
      IPFS/Kubo in Docker, verifies persisted confidential JWE blobs and checks
      host and tenant recovery after a GW restart. The in-memory local-network
      smoke remains a faster development check but is not the final
      reproducibility evidence.
    - A project deliverable that claims governed participant onboarding must
      also reproduce the trust control plane. Run the offline `dataspace-ca-ts`
      tests and bootstrap/publish a disposable local Root/issuer trust tree,
      then run `dataspace-ica-ts` locally and verify that signed onboarding
      evidence produces the participant VC consumed by GW. This is a separate
      gate from the Fabric Root CA/Fabric ICA that enroll MSP identities.

## 4. Authentication Clarity (Real vs Simulated)

- Firebase emulator/mocks are valid for local and integration behavior tests.
- They are not equivalent to a real production-like identity verification chain.
- If the target is real auth E2E (real `id_token` verification path), use:
  - `npm run test:e2e:real`
- This command performs a precheck:
  - if `gcloud` login/token is missing, it stops and prints exact login steps;
  - after authentication, rerun the same command.

## 5. Cross-Repo Live E2E: ICA + GW + SDK Node

This is the canonical order for real verification of the legal-organization
host onboarding flow:

1. local process E2E from a real TTY
2. local Docker E2E against the built image
3. staging E2E
4. only after that, production image/deploy

These runs are driven from `gdc-sdk-node-ts/tests/live-gw-node-runtime.e2e.test.mjs`,
but the operational setup belongs here because the most expensive failures were
environment mistakes, not code regressions.

For open-source audit evidence, preserve the terminology and artifacts for all
four trust/runtime layers:

1. offline dataspace Root CA and issuer publication from `dataspace-ca-ts`;
2. local dataspace ICA evidence verification and VC issuance from
   `dataspace-ica-ts`;
3. Fabric Root CA/Fabric ICA plus the `local-network` MSP and channels;
4. GW runtime with PostgreSQL metadata and encrypted JWE blobs in IPFS/Kubo.

The dataspace Root private key remains offline. The dataspace ICA is the online
onboarding issuer. Neither is interchangeable with the Fabric ICA.

The presentation-grade aggregate gate is:

```bash
IMAGE_NAME="gw-core:<version>-<commit>" \
  npm run evidence:open-source-production-readiness
```

It adds the governed host boundary to the trust and runtime gates. The local
Fabric members are `Host1MSP` and `Host2MSP`; VAT-addressed tenant
Organizations are not Fabric MSPs. The manifest records repository commits,
the exact image ID, public CA artifacts, gate statuses and SHA-256 hashes
without copying CA private keys, Fabric enrollment secrets or the local KEK.
The human-only production projection routes EU Organizations/employees to
`identity-eu` and individuals to `identity-global`; animal/veterinary channels
are outside this evidence scope.

The presentation-grade aggregate gate is:

```bash
IMAGE_NAME="gw-core:<version>-<commit>" \
  npm run evidence:open-source-production-readiness
```

It adds the governed host boundary to the trust and runtime gates. The local
Fabric members are `Host1MSP` and `Host2MSP`; VAT-addressed tenant
Organizations are not Fabric MSPs. The resulting manifest records repository
commits, the exact image ID, public CA artifacts, gate statuses and SHA-256
hashes without copying CA private keys, Fabric enrollment secrets or the local
runtime KEK.

### 5.1 Terminology That Must Not Be Mixed

- `JURISDICTION`:
  tenant/business jurisdiction carried in onboarding claims, often `ES`
- `HOST_JURISDICTION`:
  host route jurisdiction used in `/host/cds-{jurisdiction}/v1/{hostNetwork}/...`
- `HOST_NETWORK`:
  host runtime/network selector such as `test`, `test-network`, `network`
- `SECTOR`:
  tenant business sector such as `health-care` or `veterinary`

If you confuse those four values, the test may fail with misleading `404`,
`415`, or ICA routing errors even when the application code is correct.

### 5.2 Non-Negotiable Local ICA Variables

For GW local process and GW Docker runs, the ICA base URL variables are:

```bash
ICA_MODE=external
ICA_URL_EXTERNAL=http://127.0.0.1:3310
```

Do not waste time with legacy/nonexistent names such as `ICA_EXTERNAL_URL`.
The current GW config reads `ICA_URL_INTERNAL` / `ICA_URL_EXTERNAL`.

### 5.3 Local Process E2E From A Real TTY

Terminal 1, start ICA:

```bash
cd ../dataspace-ica-ts
npm run api:local
```

Expected ready log:

```text
ICA verify API listening on http://0.0.0.0:3310
```

Terminal 2, start GW:

```bash
cd ../gwtemplate-node-ts
HOST_ID_VALUE=LOCALTXN$(date +%Y%m%d%H%M%S) \
ICA_MODE=external \
ICA_URL_EXTERNAL=http://127.0.0.1:3310 \
npm run api:local-demo
```

Terminal 3, run the SDK live slice from a real TTY:

```bash
cd ../gdc-sdk-node-ts
BASE_URL=http://127.0.0.1:3000 \
HOST_NETWORK=test \
RUN_LIVE_GW_E2E=1 \
RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1 \
LIVE_GW_E2E_SUITE=professional \
npm run test:e2e:live-gw
```

### 5.4 Local Docker E2E Against The Built Image

Build the image:

```bash
cd ../gwtemplate-node-ts
./docker_build_local.sh
```

Run the container with local ICA wired from Docker to the host:

```bash
docker rm -f gwtemplate-docker-e2e 2>/dev/null || true
docker run -d \
  --env-file ./.env.local-demo \
  -e HOST_ID_VALUE=LOCALDOCKER$(date +%Y%m%d%H%M%S) \
  -e ICA_MODE=external \
  -e ICA_URL_EXTERNAL=http://host.docker.internal:3310 \
  -p 8000:3000 \
  --name gwtemplate-docker-e2e \
  gwtemplate
docker logs --tail 80 gwtemplate-docker-e2e
```

Expected ready log:

```text
[GW-API] Listening on 0.0.0.0:3000
```

Run the same SDK live slice against Docker:

```bash
cd ../gdc-sdk-node-ts
BASE_URL=http://127.0.0.1:8000 \
HOST_NETWORK=test \
RUN_LIVE_GW_E2E=1 \
RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1 \
LIVE_GW_E2E_SUITE=professional \
npm run test:e2e:live-gw
```

### 5.5 Staging E2E Checklist

Before blaming the runtime, verify these inputs explicitly:

- `BASE_URL=https://<host-domain>`
- `HOST_NETWORK=test-network` for staging unless the published host says otherwise
- `HOST_JURISDICTION=EU` when the host routes are published under `/host/cds-EU/...`
- `JURISDICTION=ES` only if the tenant claims really belong to Spain

Example staging command:

```bash
cd ../gdc-sdk-node-ts
BASE_URL=https://globaldatacare-test-961105121121.europe-southwest1.run.app \
HOST_JURISDICTION=EU \
HOST_NETWORK=test-network \
RUN_LIVE_GW_E2E=1 \
RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1 \
LIVE_GW_E2E_SUITE=professional \
npm run test:e2e:live-gw
```

Transport note:

- some shared staging profiles, including veterinary slices, may still admit
  non-secure DIDComm or even legacy FHIR transport
- do not assume that for legal-organization host onboarding
- verify the actual deployed `SECURITY_MODE` of the target host before treating
  plaintext transport as canonical

### 5.6 Fast Failure Symptoms

- `ICA verification URL is not configured`
  means the GW process/container did not receive `ICA_URL_EXTERNAL`
- `404` on `_transaction-response`
  often means `_transaction` was never accepted in the first place
- `415 Unsupported Content-Type`
  means the target environment does not accept the transport you sent for the
  current `SECURITY_MODE`
- `/host/cds-ES/...` vs `/host/cds-EU/...`
  is a host-route mismatch, not a tenant-claims mismatch
