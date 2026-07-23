# 22 Environment Variables Reference

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- explain what each environment-variable block is for,
- reduce confusion between runtime, deployment, crypto, storage, and research
  settings,
- keep `env.example` as the editable template and this file as the reading
  guide.

Rule:

- if an `env.*` template and this document ever disagree, the runtime behavior
  in code wins, and the docs must be updated.

## How to read this file

Not every variable has the same importance.

Use this priority:

1. required for almost every local runtime,
2. required only for a selected provider or deployment mode,
3. optional or advanced,
4. test-only or script-only.

Also keep this split in mind:

- operational runtime settings configure the current GW host,
- provider settings configure storage, queue, ledger, or crypto backends,
- research-store settings describe the planned separate digital twin store,
- deployment settings are for scripts and cloud packaging, not ordinary API
  runtime behavior.

## Quick Starting Sets

If you only need a local in-memory demo:

- `NODE_ENV=demo`
- `SECURITY_MODE=compat` or `demo`
- `NETWORK_MODE=test`
- `QUEUE_PROVIDER=mem`
- `DB_PROVIDER=mem`
- `STORAGE_PROVIDER=mem`
- host bootstrap fields

If you need local PostgreSQL:

- previous demo values plus:
- `DB_PROVIDER=postgres`
- `POSTGRES_*`

If you need the planned separate research store later:

- keep current runtime settings,
- then add `RESEARCH_STORE_*` explicitly,
- do not assume `POSTGRES_*` is reused unless
  `RESEARCH_STORE_SEPARATE_DB=false`.

## 1. Environment Settings

`NODE_ENV`
- Overall Node runtime mode.
- In this repo, `demo` is commonly used for the local demo path.
- `development` is also valid, but usually implies stricter crypto/runtime
  expectations than the demo path.

`LOCAL_SERVICE_ROLE`
- Comma-separated local roles enabled in the current process.
- Typical local value: `HOST,ICA,CA`.
- Matters mostly for local multi-role runs and test setups.

## 2. Security And Network Modes

`SECURITY_MODE`
- Transport/auth posture selector.
- Allowed values: `strict`, `compat`, `demo`.
- `strict` is the production-oriented posture.
- `compat` keeps compatibility bridges enabled.
- `demo` is the most permissive local/demo posture.

`NETWORK_MODE`
- Selects the host/network segment behavior.
- Allowed values: `test`, `local-network`, `test-network`, `network`.
- If omitted, the server derives it from `NODE_ENV`.

`FHIR_LEGACY`
- Enables legacy-compatible FHIR behavior where the runtime still supports it.
- Useful only when you intentionally need compatibility paths.

`JSON_LEGACY`
- Enables legacy JSON/API compatibility behavior.
- Use only if the flow depends on older compatibility shapes.

`DIDCOMM_PLAIN`
- Enables plaintext DIDComm mode where supported.
- Local/dev convenience switch.

`DEMO_ALLOW_INSECURE_BEARER`
- Allows insecure demo bearer handling for local/demo scenarios.
- Never treat this as a production setting.

## 3. Deterministic Key Generation

`DEV_SEED`
- Forces deterministic key generation for local/dev/test runs.
- Keeps repeated startup behavior stable so local curl/tests do not drift.

## 4. Gateway And Sector Selection

`MAINSECTOR`
- Main business vertical for the current host.
- Expected values in this repo: `animal` or `health`.

`SUBSECTORSALLOWED`
- Comma-separated subsectors enabled under `MAINSECTOR`.
- Typical values: `research,care,index`.
- Effective runtime sectors become `<main>-<subsector>`.

## 5. Host Bootstrap Details

These bootstrap the host tenant if it does not exist yet.

`HOST_LEGAL_NAME`
- Legal or operator-facing host organization name.

`HOST_JURISDICTION`
- Jurisdiction used by the host bootstrap.
- Often a country code such as `ES`.

`HOST_COVERAGE_SCOPE`
- Coverage or host network scope published by the host.
- Typical example: `EU`.

`HOST_ID_TYPE`
- Public identifier type for the host organization.
- Example: `TAX` or `VAT`.

`HOST_ID_VALUE`
- Concrete public identifier value for the host organization.

`HOST_ADMIN_EMAIL`
- Bootstrap admin email.

`HOST_ADMIN_UID`
- Bootstrap admin stable user ID.

`HOST_ADMIN_ROLE`
- Bootstrap admin occupational role or role code.

`HOST_TERMS_URL`
- Public terms URL presented as part of the host/operator setup.

Legacy note:

- legacy `ORG_HOST_*` variants may still be accepted by the runtime, but new
  setups should prefer `HOST_*`.

## 6. Public And Internal Host URLs

`HOST_EXTERNAL_DOMAIN`
- Highest-priority public domain for the host.
- Used when the runtime needs to publish its external base URL.

`HOST_EXTERNAL_PORT`
- Optional public port paired with the external host/domain.

`ICA_EXTERNAL_DOMAIN`
- Optional public authority domain for authority publication or well-known
  flows.
- This is not the same as the operational ICA routing URL.

`CA_EXTERNAL_DOMAIN`
- Optional CA domain for authority publication or related test flows.

`ICA_MODE`
- How GW resolves the ICA integration.
- Current known values in code: `internal`, `external`.

`ICA_URL_INTERNAL`
- Internal ICA routing URL used by the runtime.

`ICA_URL_EXTERNAL`
- Public or externally visible ICA URL when the flow needs it.

`ICA_JURISDICTION`
- ICA route scope used in `/ica/cds-{jurisdiction}/...`.
- Do not confuse this with host or tenant jurisdiction claims.

`ICA_DID_WEB`
- Optional DID for the ICA when explicitly configured.

`ICA_TLS_CA_PEM`
- Optional CA PEM for TLS validation when the ICA endpoint requires it.

`HOST_INTERNAL_IP`
- Local bind address for the GW process.
- For Cloud Run, do not hardcode a local-only address.

`HOST_INTERNAL_PORT`
- Local bind port for the GW process.

## 7. Payment And Invoice Settings

`PAYMENT_PROVIDER`
- Payment backend selector.

`INVOICE_PROVIDER`
- Invoice backend selector.

`INVOICE_FLOW`
- Invoice flow mode.
- Example from templates: `pre`.

`STRIPE_TAX_ENABLED`
- Enables/disables Stripe tax behavior where the Stripe path is used.

`STRIPE_SECRET_KEY`
- Stripe secret API key.

`STRIPE_WEBHOOK_SIGNING_SECRET`
- Secret for validating Stripe webhook signatures.

`STRIPE_SUCCESS_URL`
- Redirect URL after successful payment.

`STRIPE_CANCEL_URL`
- Redirect URL after cancelled payment.

## 8. Email Notification Settings

`EMAIL_NOTIFICATION_PROVIDER`
- Notification provider selector.
- Local suggestion: `console`.
- Staging/production example: `sendgrid`.

`SENDGRID_API_KEY`
- SendGrid API key when SendGrid is used.

`EMAIL_FROM`
- Sender email address.

`EMAIL_FROM_NAME`
- Sender display name.

## 9. Envelope And Root-Key Custody

`ENVELOPE_PROVIDER`
- Root-key custody provider for wrapping/unwrapping persisted KMS key
  material.
- Allowed values: `memory`, `local`, `gcp-kms`, `hashicorp-transit`.

`KEK_SECRET`
- Local compatibility root secret.
- Used only when `ENVELOPE_PROVIDER=local`.
- Development-only default in templates; not a production pattern.

`GCP_KMS_KEY_NAME`
- Fully qualified external GCP KMS key name.
- Used only when `ENVELOPE_PROVIDER=gcp-kms`.

`HASHICORP_TRANSIT_BASE_URL`
- HashiCorp base URL for Transit-backed root-key custody.

`HASHICORP_TRANSIT_MOUNT_PATH`
- Transit engine mount path.

`HASHICORP_TRANSIT_KEY_NAME`
- Transit key name.

`HASHICORP_TRANSIT_TOKEN`
- Transit access token.

`HASHICORP_NAMESPACE`
- Optional namespace for multi-namespace Vault setups.

## 10. Legacy Signing And X.509 Exposure

`LEGACY_SIGN_ALG`
- Legacy ECDSA signing algorithm used where older contracts still expose it.

`SMART_TOKEN_LEGACY`
- Enables legacy smart-token compatibility mode.

`SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS`
- Comma-separated `did:web` issuer allowlist for
  `SubjectIdentityBindingCredential`.
- Applied only after the enclosing VP proof is verified.
- Allows exact equivalence between individual DIDs in the routed sector.
- Does not trust arbitrary DID Document aliases and does not authorize physical
  support/card DIDs.
- Leave empty to reject all cross-portal individual DID bindings.

`LEGACY_X509_DER_BASE64`
- Base64 DER certificate payload for legacy exposure paths.

`LEGACY_X509_CHAIN_BASE64`
- Base64 certificate chain for legacy exposure paths.

## 11. Clearing House

`CLEARING_HOUSE_MODE`
- VP verification mode.
- Example template value: `stub` for local use.

`CLEARING_HOUSE_URL`
- Remote clearing-house URL when a non-stub mode is used later.

## 12. Ledger Routing

`LEDGER_PROVIDER_DEFAULT`
- Default ledger provider.

`LEDGER_PROVIDER_MAP`
- Per-network/provider routing map.

`LEDGER_FABRIC_MSP_ID`
- Fabric MSP identifier.

`LEDGER_FABRIC_ITEM_TYPE`
- Ledger item type.

`LEDGER_IDENTITY_CHANNEL_DEFAULT`
- Default identity channel when no jurisdiction/sector override is applied.
- Local recommendation:
  - `local-network` -> `identity-local`
  - `test-network` keeps the existing jurisdiction-derived fallback unless an explicit override is set.

`LEDGER_GENESIS_VERIFICATION`
- Enables live block-zero verification. It may be `false` for the
  `staging/test-network` MVP. It is mandatory for `prod` or `network`.
- This switch identifies the ledger; it does not authorize hosts, tenants,
  channels or write operations.

`LEDGER_CHANNEL_GENESIS_SHA256`
- Internal generated map of `channel=sha256(block-zero)` entries passed from
  Fabric provisioning to the current runtime.
- It is not required when verification is disabled in `staging/test-network`.
- It is not maintained by a human controller, stored in the host PDF or used
  as business authorization.
- Its channel names form the technical host channel ceiling. Tenant,
  organization, license/role, action, sector and jurisdiction still determine
  whether an operation may read or write.

There is no per-host chaincode allowlist in the MVP. GW business authorization
and Fabric policies control operations against chaincodes available in an
authorized channel.

Audit and migration details:
[27-fabric-authorization-and-ledger-binding.md](./27-fabric-authorization-and-ledger-binding.md).

## 13. Local Authority Artifact Overrides

`LOCAL_CA_ARTIFACTS_DIR`
- Optional local CA artifact override directory.

`LOCAL_ICA_ARTIFACTS_DIR`
- Optional local ICA artifact override directory.

## 14. PKI Generation Variables

These are mainly for `scripts/generate-pki-chain.ts`.

Root CA block:

`ROOT_CA_DOMAIN`
`ROOT_CA_REGION`
`ROOT_CA_JURISDICTION`
`ROOT_CA_CITY`
`ROOT_CA_STREET`
`ROOT_CA_POSTAL_CODE`
`ROOT_CA_LEGAL_ID_TYPE`
`ROOT_CA_LEGAL_ID_NUMBER`
`ROOT_CA_LEGAL_NAME`
`ROOT_CA_SEED`

Meaning:

- these define certificate-subject and organization metadata for the generated
  root CA fixtures.

ICA block:

`ICA_DOMAIN`
`ICA_REGION`
`ICA_JURISDICTION`
`ICA_CITY`
`ICA_STREET`
`ICA_POSTAL_CODE`
`ICA_LEGAL_ID_TYPE`
`ICA_LEGAL_ID_NUMBER`
`ICA_LEGAL_NAME`
`ICA_SEED`

Meaning:

- same idea as the Root CA block, but for the generated ICA fixtures.

Host certificate block:

`HOST_REGION`
`HOST_JURISDICTION`
`HOST_CITY`
`HOST_STREET`
`HOST_POSTAL_CODE`
`HOST_LEGAL_ID_TYPE`
`HOST_LEGAL_ID_NUMBER`
`HOST_LEGAL_NAME`
`HOST_DOMAIN`
`HOST_CN`
`HOST_SEED`

Meaning:

- used for generated PKI certificate identity, not the host tenant business
  bootstrap record.

## 15. Test-Only Real Signed Individual PDF Fixture

These variables are for specific local/integration tests only.

`TEST_INDIVIDUAL_FORM_PDF_PATH`
- Path to the signed PDF fixture.

`TEST_INDIVIDUAL_CONTROLLER_CERT_CN`
`TEST_INDIVIDUAL_CONTROLLER_CERT_SN`
`TEST_INDIVIDUAL_CONTROLLER_CERT_GN`
`TEST_INDIVIDUAL_CONTROLLER_CERT_SERIALNUMBER`
`TEST_INDIVIDUAL_CONTROLLER_CERT_COUNTRY`
`TEST_INDIVIDUAL_CONTROLLER_EMAIL`
`TEST_INDIVIDUAL_ORGANIZATION_ALTNAME`
`TEST_INDIVIDUAL_CONTROLLER_BIRTHDATE`
`TEST_INDIVIDUAL_CONTROLLER_GENDER`

Meaning:

- expected extracted signer/subject values used by tests that map real signed
  onboarding PDFs into GW claims.

## 16. Fabric CA Admin Credentials

`ROOT_CA_ADMIN_USER`
- Root CA admin username for optional Fabric CA flows.

`ROOT_CA_ADMIN_PASS`
- Root CA admin password.

`ICA_ADMIN_USER`
- ICA admin username.

`ICA_ADMIN_PASS`
- ICA admin password.

## 17. Fabric Gateway Connection

Per-MSP variables:

`HLF_CERTIFICATE_Org1MSP`
`HLF_PRIVATE_KEY_Org1MSP`
`HLF_CONNECTION_PROFILE_Org1MSP`
`HLF_CONNECTION_PEM_Org1MSP`
`HLF_CONNECTION_PEER_Org1MSP`

`HLF_CERTIFICATE_Org2MSP`
`HLF_PRIVATE_KEY_Org2MSP`
`HLF_CONNECTION_PROFILE_Org2MSP`
`HLF_CONNECTION_PEM_Org2MSP`
`HLF_CONNECTION_PEER_Org2MSP`

Meaning:

- optional Hyperledger Fabric gateway material for demo/test ledger flows.

## 18. Backend Service Providers

`LOG_PROVIDER`
- Logging backend selector.
- Local/default template value: `console`.

`QUEUE_PROVIDER`
- Async queue backend selector.
- Local/default template value: `mem`.

`DB_PROVIDER`
- Main operational metadata/index provider.
- Common values in this repo: `mem`, `firestore`, `postgres`.

`STORAGE_PROVIDER`
- Confidential blob/file storage provider.
- Common values in this repo: `mem`, `gcs`, `supabase`, `ipfs`.

## 19. Main PostgreSQL Runtime

These configure the main operational PostgreSQL connection.

`POSTGRES_HOST`
- Main operational PostgreSQL host.

`POSTGRES_PORT`
- Main operational PostgreSQL port.

`POSTGRES_DB`
- Main operational PostgreSQL database.

`POSTGRES_USER`
- Main operational PostgreSQL username.

`POSTGRES_PASSWORD`
- Main operational PostgreSQL password.

`POSTGRES_SSL`
- Enables/disables SSL for the main operational PostgreSQL connection.

`POSTGRES_SCHEMA`
- Schema used by the main operational PostgreSQL runtime.

`POSTGRES_MAX_POOL_SIZE`
- Optional connection-pool size cap for the main PostgreSQL runtime.

## 20. Research Digital Twin Store

These variables describe the planned separate research/digital twin store.

Important:

- they do not change current operational vault behavior by themselves,
- keep them disabled unless you are explicitly working on the separate-store
  rollout,
- `RESEARCH_STORE_*` should be read as a separate persistence plane, not as a
  hidden alias of `POSTGRES_*`.

`RESEARCH_STORE_ENABLED`
- Master switch for the separate research-store wiring.
- `false` means ignore the research-store path.

`RESEARCH_STORE_PROVIDER`
- Persistence backend selector for the research store.
- Allowed values today in config parsing:
  - `postgres`
  - `supabase`
  - `firestore`
- Recommended first implementation target: `postgres`.

`RESEARCH_STORE_SEPARATE_DB`
- Controls whether the research store must use its own dedicated DB settings.
- `true` means require dedicated `RESEARCH_STORE_POSTGRES_*`.
- `false` means explicitly reuse the main `POSTGRES_*` connection.

`RESEARCH_STORE_POSTGRES_HOST`
- Dedicated PostgreSQL host for the research store.

`RESEARCH_STORE_POSTGRES_PORT`
- Dedicated PostgreSQL port for the research store.

`RESEARCH_STORE_POSTGRES_DB`
- Dedicated PostgreSQL database for the research store.

`RESEARCH_STORE_POSTGRES_USER`
- Dedicated PostgreSQL user for the research store.

`RESEARCH_STORE_POSTGRES_PASSWORD`
- Dedicated PostgreSQL password for the research store.

`RESEARCH_STORE_POSTGRES_SSL`
- SSL flag for the dedicated research-store PostgreSQL connection.

`RESEARCH_STORE_POSTGRES_SCHEMA`
- Schema reserved for research/digital twin objects.
- Typical clear name: `research_digital_twin`.

`RESEARCH_STORE_INDEX_PREFIX`
- Short human-chosen prefix for future research-store tables, indexes, or
  artifact names.
- Helps operators recognize these objects and avoid collisions.
- Practical example: `rtwin`.

`RESEARCH_STORE_DEFAULT_LOCALE`
- Fallback locale for text normalization when the incoming artifact does not
  carry one.
- Does not translate text.
- Only tells the future text indexer what locale to assume.
- Practical examples: `es`, `en`, `pt`.

`RESEARCH_STORE_TEXT_SEARCH_MODE`
- Planned text-search strategy for allowlisted human-readable claims.
- `postgres-simple` is the conservative initial choice.
- `postgres-tsvector` is the more PostgreSQL full-text-oriented choice.

`RESEARCH_STORE_CODE_INDEX_MODE`
- Planned code extraction/index strategy.
- Current supported value: `normalized-claims-v1`.
- Meaning: derive deterministic exact code rows from canonical claims such as
  `SYSTEM|CODE`.

## 21. Replay Protection

`REPLAY_PROTECTION_PROVIDER`
- Anti-replay provider selector.
- Values documented in `env.example`:
  - `none`
  - `mem`
  - `redis`

`REDIS_URL`
- Redis connection URL when `REPLAY_PROTECTION_PROVIDER=redis`.

`REPLAY_REDIS_KEY_PREFIX`
- Redis key prefix for replay cache entries.

## 22. Local LLM Settings

`LLM_PROVIDER`
- Optional local LLM provider selector.
- Current template example: `ollama`.

`OLLAMA_BASE_URL`
- Base URL for the Ollama runtime.

`OLLAMA_MODEL`
- Model tag available in the local Ollama installation.

## 23. GCP And Provider Credentials

`FIRESTORE_PROJECT_ID`
- GCP project used for Firestore-backed setups.

`GCS_BUCKET_NAME`
- GCS bucket used for file/blob storage.

`SUPABASE_URL`
- Base project URL for Supabase.

`SUPABASE_SERVICE_ROLE_KEY`
- Supabase service role key.

`SUPABASE_STORAGE_BUCKET`
- Supabase storage bucket name.

`SUPABASE_STORAGE_PUBLIC`
- Whether stored Supabase objects are expected to be public/stable.

`IPFS_API_URL`
- Kubo/IPFS API URL.

`IPFS_GATEWAY_URL`
- Kubo/IPFS gateway URL.

`IPFS_MFS_ROOT`
- IPFS MFS root used by the storage adapter.

`FIREBASE_API_KEY`
- Firebase web/API key used for relevant auth/testing flows.

## 24. Auth And Federation

`AUTH_TOKEN_VERIFIER`
- Chooses the ID-token verification strategy for auth flows.
- Example local value: `demo`.

`EIDAS_ISSUER`
- eIDAS OIDC issuer.

`EIDAS_CLIENT_ID`
- eIDAS OIDC client ID.

`EIDAS_JWKS_URI`
- eIDAS JWKS URI.

`GOOGLE_APPLICATION_CREDENTIALS`
- Local filesystem path to GCP credentials.
- Mostly for local development, not for managed production identity.

## 25. Deployment Variables

These are mainly for deployment scripts, not day-to-day API semantics.

`DEPLOY_REGION`
- Cloud deploy target region.

`DEPLOY_SERVICE_NAME`
- Public service name for deployment.

`ARTIFACT_REGISTRY_NAME`
- Artifact Registry repository name used by the deploy flow.

## 26. Build-Time Secrets

`NPM_TOKEN`
- Optional token for private npm package install during image builds.
- Build-time concern only; not part of normal API runtime behavior.

## Final Guidance

When someone asks "which env vars matter for my setup?", answer by deployment
profile:

1. local demo
2. local postgres
3. cloud firestore/gcs
4. cloud supabase
5. separate research-store rollout

That is easier to reason about than reading the entire `.env` as one flat list.
