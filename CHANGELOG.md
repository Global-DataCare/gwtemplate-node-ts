## [Unreleased]

## [1.14.9] - 2026-06-24

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.12`.

### Fixed
- Regenerated Swagger/OpenAPI examples and profile documents against the
  corrected shared consent claim key so generated GW docs no longer expose the
  camelCase form `Consent.attachment-contentType`.

## [1.14.8] - 2026-06-24

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.11`.
- Moved the versioned generated OpenAPI profile documents out of
  `artifacts/openapi-profiles` and into `docs/openapi-profiles` so `artifacts/`
  can remain reserved for ephemeral logs, traces, and local test output while
  Swagger UI still serves the profile selector at runtime.
- Added deterministic demo token test fixtures that reuse the shared
  `gdc-common-utils-ts` JWT/JWK helpers so GW tests regenerate stable `id_token`
  and `vp_token` signers from fixed seeds instead of embedding ad hoc literal
  keys.

### Fixed
- Reused already assigned controller/employee seats during
  `Organization/_issue` before consuming an `available` pool license, allowing
  reinstalls/rebinds to reissue activation codes for the same actor instead of
  failing on exhausted free stock.
- Fixed host legal-organization onboarding so GW no longer derives the ICA
  verification route jurisdiction from `HOST_JURISDICTION`. `_transaction`
  now resolves the ICA route scope from the configured trusted ICA and returns
  a functional `400 OperationOutcome` when that jurisdiction cannot be
  resolved in demo/local environments instead of drifting into downstream
  `500` failures.
- Added controller identity resolution for `Organization/_issue` so demo mode
  can accept payload fallbacks while strict mode reuses the verified bearer
  payload and persisted controller role when available.

## [1.14.7] - 2026-06-23

### Changed
- Clarified docs, Swagger/OpenAPI descriptions, and host-flow comments so
  `Organization/_transaction` is treated as the canonical legal-organization
  onboarding step and `Organization/_activate` is documented as legacy
  compatibility, not a required follow-up after `_transaction`.
- Documented the current GW/ICA trust model as one trusted operational ICA per
  host/deployment, configured explicitly via `ICA_URL_*`,
  `ICA_JURISDICTION`, and optionally `ICA_DID_WEB`, rather than a dynamic list
  of trusted ICAs selected from CA/issuer metadata.
- Added host `Organization/_issue` as the existing-tenant reverify/rebind path:
  it reuses ICA `_verify`, does not create a new Offer, and reissues one
  controller activation code from the already contracted seat pool so the
  frontend can continue with `Token/_exchange` + `Device/_dcr`.
- Added controller identity resolution for `Organization/_issue` so demo mode
  can accept payload fallbacks while strict mode reuses the verified bearer
  payload and persisted controller role when available.
- Added deterministic demo-token test fixtures for `id_token` and `vp_token`
  so security-sensitive GW tests can regenerate stable EC signing keys from a
  fixed seed, verify real JOSE signatures locally, and expose the exact
  `header.payload` bytes that KMS-backed BFF/controller signers would sign in
  production.

### Fixed
- Fixed host legal-organization onboarding so GW no longer derives the ICA
  verification route jurisdiction from `HOST_JURISDICTION`. `_transaction`
  now resolves the ICA route scope from the configured trusted ICA and returns
  a functional `400 OperationOutcome` when that jurisdiction cannot be
  resolved in demo/local environments instead of drifting into downstream
  `500` failures.
- Reused already assigned controller/employee seats during `Organization/_issue`
  before consuming an `available` pool license, allowing reinstalls/rebinds to
  reissue activation codes for the same actor instead of failing on exhausted
  free stock.

## [1.14.6] - 2026-06-23

### Fixed
- Normalized legacy `Organization/_activate` claims before tenant vault
  creation so missing `org.schema.Organization.address.addressCountry` no
  longer crashes with an internal `500` before returning an
  `OperationOutcome`.
- Wrapped Gaia-X legal participant option generation in the activation
  finalization path so demo/compat onboarding no longer leaks unexpected
  exceptions during tenant provisioning.
- Added regression coverage for the legacy activation path that previously
  crashed while building the tenant collection name from incomplete claims.

## [1.14.5] - 2026-06-19

### Changed
- Removed the legacy in-repo `devnet/` copy so local Fabric development now
  uses only the sibling repo `../fabric-multicloud/devnet/fabric-v3`.

## [1.14.4] - 2026-06-19

### Changed
- Documented the workspace layout cleanup that removes the in-repo
  `fabric-multicloud/` copy and standardizes operational references on the
  sibling repo `../fabric-multicloud`.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.6`.
- Switched host/runtime and docs to the canonical
  `application/didcomm-plain+json` media type.
- Added temporary startup compatibility for legacy
  `application/didcomm-plaintext+json` while dependent packages and clients
  finish migrating.

## [1.14.0] - 2026-06-14

### Added
- Added persistent Firestore/GCS storage tracing so local and live runs can
  emit JSONL timing records for repository and blob-store operations in:
  - `src/utils/storage-trace.ts`
- Added lightweight section listing semantics to the vault repository contract
  so search/index paths can iterate persisted records without hydrating JWE
  blobs:
  - `src/database/repositories/vault/vault.repository.ts`
  - `src/database/repositories/vault/vault.mem.repository.ts`
  - `src/database/repositories/postgres/postgres.vault.repository.ts`
  - `src/database/repositories/firestore/firestore.vault.repository.ts`
- Added cache-aware tenant existence checks to the tenant cache contract so
  managers that already depend on `TenantsCacheManager` can reuse hydrated
  host/tenant registrations instead of re-querying storage:
  - `src/managers/ITenantsManager.ts`
  - `src/managers/TenantsCacheManager.ts`
- Added explicit capability-bounded tenant-registry interfaces so runtime,
  routing, discovery, ledger, and hosting flows no longer all depend on the
  same concrete tenant cache type:
  - `src/managers/IApiTenantRegistry.ts`
  - `src/managers/IDiscoveryTenantRegistry.ts`
  - `src/managers/IHostRuntime.ts`
  - `src/managers/IHostingTenantRegistry.ts`
  - `src/managers/ILedgerTenantRegistry.ts`
  - `src/managers/IPrivilegedTenantRegistry.ts`
  - `src/managers/ITenantDidRegistryMutator.ts`
- Added dedicated hosting sub-services so `HostingManager` no longer keeps all
  offer/order search and lifecycle logic inline:
  - `src/managers/hosting/HostingLifecycleService.ts`
  - `src/managers/hosting/HostingOfferOrderService.ts`
- Added explicit lightweight public projection support to the confidential
  storage model so copied/generated consultation data can live outside
  encrypted payloads when required for runtime lookup or gating:
  - `gdc-common-utils-ts@^1.24.1`

### Changed
- Split heavy read semantics from index-only search semantics in Firestore and
  PostgreSQL vault repositories:
  - `getContainersInSection(...)` remains the hydrated/full-read path
  - `listContainersInSection(...)` is now the lightweight/index-only path
  - `query(..., { hydrate: false })` skips confidential blob hydration for
    search flows that only need indexed claims
- Updated the following managers to use lightweight listing/query paths for
  search and composition projection flows, reducing unnecessary GCS blob
  downloads during Firestore-backed live runs:
  - `src/managers/CompositionManager.ts`
  - `src/managers/CommunicationManager.ts`
  - `src/managers/IndividualManager.ts`
  - `src/managers/MedicationStatementManager.ts`
- Changed Firestore `vaultExists(...)` so existence checks no longer hydrate the
  host tenant-registration JWE from GCS just to answer a boolean existence test.
- Updated managers that already receive `TenantsCacheManager` so tenant
  existence checks reuse the in-memory tenant cache where possible instead of
  going back to the repository:
  - `src/managers/CommunicationManager.ts`
  - `src/managers/IndividualManager.ts`
  - `src/managers/OpenIdAuthManager.ts`
- Renamed the ambiguous commercial read-model helper to an offer/order-specific
  name and aligned tests/utilities with that terminology:
  - `src/utils/offer-order-read-model.ts`
  - `src/__tests__/unit/utils/offer-order-read-model.test.ts`
- Moved offer/order search handling out of `HostingManager` and `FamilyManager`
  onto lightweight indexed queries instead of reopening encrypted vault
  records for readback screens.
- Narrowed runtime managers away from the concrete `TenantsCacheManager`
  implementation. Ordinary managers now consume minimal interfaces or host
  scalars instead of a broad tenant-registry capability surface.
- Updated tenant runtime caching so:
  - general metadata lookups use a sanitized runtime projection
  - explicit full reads remain privileged
  - host lifecycle and tenant lifecycle refreshes invalidate/reload cache after
    storage writes
- Tightened lifecycle gating so hosted tenant/host disable and purge flows
  respect real descendants while ignoring known auxiliary records that should
  not block lifecycle transitions:
  - bootstrap technical controller records
  - auxiliary `Occupation` records stored in `employees`
- Corrected host lifecycle resolution so host disable/purge no longer tries to
  resolve the host through hosted-tenant reverse lookup by `identifier.value`.
- Added submit-time hosted individual gating in the family/individual flow so a
  disabled tenant cannot create new hosted individual registrations.
- Reduced several route/service full-tenant reads to narrower metadata lookups:
  - `src/routes/api.ts`
  - `src/routes/discovery.ts`
  - `src/routes/ledger.ts`
  - `src/services/DiscoveryService.ts`
- Updated the shared dependency target to `gdc-common-utils-ts@^1.24.1`.
- Refreshed generated OpenAPI profile artifacts after the latest local build.

### Performance Notes
- Live `Firestore + GCS` tracing identified the primary latency source as
  repeated hydration of the host/tenant registration JWE during existence
  checks and search/list flows.
- The storage optimizations above materially reduced live-suite overhead during
  local Firestore+GCS runs by:
  - replacing repeated blob hydration with lightweight index-only reads where
    full JWE payloads were not needed
  - avoiding GCS downloads for Firestore `vaultExists(...)`
  - shifting some tenant existence checks onto the tenant cache
- Lifecycle descendant scans now use `listContainersInSection(...)` rather than
  hydrated reads, which materially reduced GCS traffic during host/tenant
  lifecycle validation.

### Security And Boundaries
- Documented capability boundaries with JSDoc so future changes do not quietly
  widen tenant-registry access again.
- Split general runtime tenant lookup from privileged control-plane reads so
  everyday managers no longer depend on a type that can decrypt full tenant
  registrations by default.

### Validation
- `npm run type-check`
- `npm run api:local-demo` + `HOST_ID_VALUE=... npm run test:e2e:live-gw`
- `npm run api:local-firestore-demo` + `HOST_ID_VALUE=... npm run test:e2e:live-gw`

## [Unreleased]

## [1.14.3] - 2026-06-18

### Added
- Added the host-side legal-organization verification transaction contract as a
  first-class onboarding step so GW can forward PDF evidence to ICA `_verify`
  and return the next commercial step for `Order/_batch`:
  - `src/managers/HostingManager.ts`
  - `src/routes/api.ts`
  - `src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts`
  - `src/__tests__/data/example-payloads.ts`
- Added explicit operational testing guidance for the real verification order:
  local process TTY, local Docker, staging, then production:
  - `TESTING.md`
- Added `v1.5-tabla-portal-api-gw.md` and refreshed the portal/BFF mapping docs
  so organization onboarding and public DID resolution are documented from the
  external integration perspective:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/PORTAL_API_TO_GW_CORE.md`
  - `docs/API_CORE_INTEGRATION.md`
  - `docs/OPENAPI_PROFILE_MATRIX.md`

### Changed
- Updated GW to consume `gdc-common-utils-ts@^2.0.5` and reuse shared
  DIDComm submit constants plus shared legal-organization bundle helpers
  instead of local string literals/path drilling:
  - `src/managers/HostingManager.ts`
  - `src/__tests__/unit/managers/HostingManager.test.ts`
  - `src/__tests__/unit/utils/swagger-spec.test.ts`
- Clarified the OpenAPI/Swagger contract for `Organization/_transaction`,
  including the response bundle, examples, and profile exports:
  - `swagger.config.cjs`
  - `src/utils/swagger-spec.ts`
  - `artifacts/openapi-profiles/openapi-core.json`
  - `artifacts/openapi-profiles/openapi-compat.json`
  - `artifacts/openapi-profiles/openapi-extension.json`
- Fixed deploy/runtime configuration so Cloud Run and local-demo can receive
  explicit ICA routing and security/network variables for host-side
  `_transaction` verification:
  - `cloud_deploy.sh`
  - `env.local-demo.example`
  - `src/server.ts`
- Refreshed repository docs and examples to point integrators at the canonical
  live verification flow and contract surface:
  - `README.md`
  - `docs/90.A-API_INTEGRATORS_GUIDE.md`

### Testing
- `npm test -- --runInBand src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts src/__tests__/unit/utils/swagger-spec.test.ts`

### Changed
- Updated `v1.5-tabla-portal-api-gw.md` so the portal-facing organization
  onboarding contract is documented as `organization-registrations` instead of
  exposing GW-internal `verification-transaction` / activation / order steps as
  frontend-first routes.
- Extended `v1.5-tabla-portal-api-gw.md` with a dedicated public `did:web`
  resolution block so portal `GET .../.well-known/did.json` facades are
  documented as projections of the real GW-hosted DID documents rather than as
  a separate identity plane.
- Added `v1.5-tabla-portal-api-gw.md` and refreshed the canonical portal/BFF
  mapping docs so legal-organization `Organization/_transaction` is treated as
  a first-class portal-facing operation and tenant-side `Organization/_binding`
  is explicitly tracked as a pending GW/OpenAPI publication rather than being
  silently implied:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/PORTAL_API_TO_GW_CORE.md`
  - `docs/API_CORE_INTEGRATION.md`
  - `docs/OPENAPI_PROFILE_MATRIX.md`
- Bumped the GW package patch version from `1.14.1` to `1.14.2` to publish the
  `gdc-common-utils-ts@^2.0.2` adoption alongside the corresponding image/deploy
  tag lineage.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.2`.
- Updated demo `_activate` representative binding fallback so GW now consumes
  the canonical shared RFC 9278 JWK-thumbprint helper from
  `gdc-common-utils-ts` instead of maintaining a local derivation path:
  - `src/managers/HostingManager.ts`
- Normalized demo/plaintext representative fallback material to the canonical
  `urn:ietf:params:oauth:jwk-thumbprint:sha-256:<base64url>` form when ICA
  omits `credentialSubject.hasCredential.material`, using controller JWK data
  first and only preserving an already-prefixed fallback `kid` value when no
  JWK is available.
- Updated activation route/unit coverage so GW assertions compare against the
  same shared thumbprint helper used by SDK/common-utils:
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.1`.
- Refreshed generated core-flow and OpenAPI profile artifacts so activation
  examples now show the canonical hashed controller `sameAs` form rather than
  `mailto:` fallback examples:
  - `artifacts/core-flow-examples.json`
  - `artifacts/openapi-profiles/openapi-compat.json`
  - `artifacts/openapi-profiles/openapi-core.json`
  - `artifacts/openapi-profiles/openapi-extension.json`
- Added an explicit GW CORE architecture baseline so backend contract ownership
  and layering against shared SDK packages is documented in-repo:
  - `ARCHITECTURE.md`
- Refreshed the Docker build dependency checksum after the current dependency
  graph changes:
  - `.docker-build-deps.sha256`

## [1.14.1] - 2026-06-16

### Changed
- Activation onboarding now fills missing
  `org.schema.Organization.identifierValue` from ICA
  `organizationCredential.credentialSubject.taxID` and defaults
  `org.schema.Organization.identifierType` to `UUID` when the identifier value
  is a UUID, otherwise to `TAX`, before generating the canonical organization
  URN. When `alternateName` is also missing for a legal organization, GW now
  derives it from the final canonical `identifierValue`, so tax-id-only
  onboarding becomes `taxID -> identifierValue -> alternateName`, while an
  explicit legal identifier still wins over `taxID` for path-facing tenant ids
  and vault ids. This avoids activation failures when ICA-first payloads omit
  the flat identifier claims:
  - `src/managers/HostingManager.ts`
- Documented the conservative communication-retention lifecycle boundary so
  individual, tenant, and host purge flows can skip retained `Communication`
  records by default while `COMMUNICATION_RETENTION_DISABLED=false`, and added
  explicit audit/compliance references in:
  - `docs-v2/16-deactivation-and-purge-lifecycle.md`
- Relaxed ICA activation representative validation so `Organization/_activate`
  no longer requires the representative VC `credentialSubject.id` to be a
  `did:web`; non-DID subject ids such as `urn:person:...` now pass while GW
  still enforces representative role and key-binding policy through:
  - `src/adapters/activation-trust.adapter.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- In `SECURITY_MODE=demo`, `Organization/_activate` now backfills a missing
  representative `credentialSubject.hasCredential.material` from explicit
  `controller.publicKeyJwk.kid` or DIDComm `meta.jws.protected.kid` before
  running shared activation policy validation. Production/strict modes remain
  unchanged; this is a demo bootstrap fallback for ICA payloads that still do
  not emit representative binding data:
  - `src/managers/HostingManager.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- Added/updated portal/backend-facing operational docs for the new v1.3
  lifecycle and deploy flow:
  - `v1.3-tabla-portal-api-gw.md`
  - `DEPLOY.md`
  - `demo-deploy.config.example`
  - `cloud_deploy.sh`
  - `.docker-build-deps.sha256`
- Clarified the release scope to include the VC verification fix in
  `_activate`, along with the communication-search and lifecycle hardening work
  already in flight across:
  - `src/__tests__/unit/adapters/activation-trust.adapter.test.ts`
  - `src/utils/services.ts`
  - `src/managers/CommunicationManager.ts`
  - `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- Added indexed `Communication/_search` support for communication channel
  records, including normalized participant matching, claim-based search
  filters, shared pagination semantics, and canonical `search-response`
  envelopes in:
  - `src/managers/CommunicationManager.ts`
  - `src/utils/services.ts`
  - `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- Updated the root deployment entrypoint so GKE deployments can now be selected
  by profile via `./cloud_deploy.sh gke <profile> [config-file]`, which loads
  `.env.gke.<profile>` before the infra-specific GKE config file.
- Kept `./cloud_deploy.sh gke-demo [config-file]` as a backward-compatible
  alias for the current `gdc` GKE profile.
- Updated `demo-deploy.config.example` so runtime GW settings are expected to
  come from `.env.gke.<profile>` instead of hardwiring `.env.local-demo`.
- Added `DEPLOY.md` at the repo root to document the practical split between
  local demo, Cloud Run deployment envs, and GKE profile-based deployment.

## [1.13.0] - 2026-06-13

### Added
- Added confidential blob persistence abstractions so encrypted vault metadata
  can keep large/private payloads in the configured storage backend instead of
  forcing every repository implementation to inline the same storage logic:
  - `src/database/storage/IConfidentialBlobStore.ts`
  - `src/database/storage/storage-adapter-confidential-blob.store.ts`
  - `src/database/repositories/vault/confidential-storage-persistence.ts`
- Added explicit lifecycle and audit documentation for deactivation and purge
  flows in:
  - `docs-v2/16-deactivation-and-purge-lifecycle.md`
- Added host/tenant discovery publication guards so dataspace discovery
  endpoints stop advertising disabled participants while keeping DID material
  resolvable for audit/readback scenarios.
- Added `_purge` support to the host registry organization service contract and
  corresponding lifecycle tests for host/tenant gating and destructive cleanup.

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.24.0`.
- Refactored infrastructure bootstrap so Firestore/PostgreSQL vault repositories
  receive a confidential blob store backed by the configured storage adapter.
- Updated Firestore/PostgreSQL vault repositories and storage adapters to
  persist blob-backed confidential payloads consistently across `mem`, GCS, and
  Supabase storage modes.
- Hardened host startup so a fresh `HOST_ID_VALUE` bootstraps first and only
  then warms the in-memory tenant cache, avoiding stale host cache state across
  local/live executions.
- Standardized local test/runtime profile documentation and loaders around
  `.env.local-demo`:
  - `jest.setup.ts`
  - `scripts/verify-auth.ts`
  - `TESTING.md`
  - `TESTING-GUIDE.md`
  - `README.md`
  - `demo-deploy.config.example`
- Simplified local stop behavior so `api:close` reuses the canonical
  `local:close` path.
- Updated Firebase initialization to resolve the project id explicitly from the
  active environment before calling `firebase-admin`.

### Lifecycle And Contract Changes
- Extended host registry lifecycle routes so `Organization/_purge` is exposed as
  a first-class contract alongside `_enable` and `_disable`.
- Tightened tenant lifecycle authorization rules:
  - a tenant cannot be disabled while active employees remain
  - a tenant cannot be disabled while active individuals/family members remain
  - a tenant cannot be purged until it is already disabled
  - a tenant cannot be purged while non-purged descendants remain
  - the host cannot be disabled or purged while hosted tenant registrations
    still exist
- Marked the bootstrap controller employee record with a dedicated lifecycle
  role so host lifecycle enforcement can ignore that synthetic record when
  counting real descendants.
- Replaced duplicated local activation service parsing with shared policy
  validation from `gdc-common-utils-ts`, enforcing required sector/service-type
  authorization during hosted activation.
- Updated discovery routes so disabled or purged hosts/tenants return
  non-published responses instead of continuing to surface dataspace metadata.

### Individual/Family Purge Semantics
- Changed family/individual purge from a soft status update to destructive
  cleanup of:
  - the stored family registration record
  - hashed subject-scoped individual sections
  - best-effort referenced confidential blobs
- Added subject identifier collection and hashed section scanning so purge
  removes all related individual/member fragments derived from the registration.
- Added best-effort blob reference traversal for `blobRef` fields and
  `*#hash`-style references before deleting the underlying vault record.

### Testing
- Expanded lifecycle/unit/integration coverage for:
  - host lifecycle gating and activation policy enforcement
  - family purge behavior
  - Firestore/PostgreSQL confidential persistence flows
  - discovery publication behavior
  - storage adapter blob persistence semantics
- Updated OpenAPI profile artifacts to reflect the current published contract.

## [1.12.1] - 2026-06-13

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.23.0`.
- Pulled the newly published shared invoice/charge-item claims surface into GW
  CORE so the hosted commercial/order flows added in `1.12.0` now consume the
  same published package version that exposes:
  - canonical `Invoice.*` claims
  - canonical `ChargeItem.*` claims
  - charge-item repeated-row builders
  - contextualized `org.hl7.fhir.api.*` invoice/charge-item projections
  - embedded `resource.meta.claims` invoice projection support
- Refreshed the lockfile so GW CORE resolves the published `1.23.0` tarball
  rather than the previous `1.22.0` line for all environments that install
  from npm.
- Kept the release intentionally code-stable inside GW CORE itself:
  - no manager/controller source logic changed in this patch
  - no OpenAPI contract files were intentionally regenerated for this patch
  - the purpose of this release is to move the runtime onto the published
    shared claims surface that backs invoice and charge-item readback

### Dependency Surface Now Available Through GW CORE
- Invoice-level claims available through the shared dependency include:
  - `Invoice.identifier`
  - `Invoice.date`
  - `Invoice.status`
  - `Invoice.subject`
  - `Invoice.recipient`
  - `Invoice.issuer`
  - `Invoice.issuer-display`
  - `Invoice.payment-terms`
  - `Invoice.payment-url`
  - `Invoice.totalnet-value`
  - `Invoice.totalnet-currency`
  - `Invoice.totalgross-value`
  - `Invoice.totalgross-currency`
- Charge-item-level claims available through the shared dependency include:
  - `ChargeItem.identifier`
  - `ChargeItem.status`
  - `ChargeItem.part-of`
  - `ChargeItem.code`
  - `ChargeItem.code-text`
  - `ChargeItem.category`
  - `ChargeItem.supplier-productcode`
  - `ChargeItem.quantity`
  - `ChargeItem.quantity-number`
  - `ChargeItem.quantity-unit`
  - `ChargeItem.items-per-unit`
  - `ChargeItem.items-quantity`
  - `ChargeItem.items-quantity-number`
  - `ChargeItem.items-quantity-unit`
- High-level shared builders/readers now available through the published
  dependency include:
  - invoice claim-row construction from `createInvoiceBundleEditor()`
  - repeated invoice + charge-item row generation
  - contextualized claim generation for query/readback paths
  - invoice `meta.claims` embedding in generated FHIR `Invoice` resources

### Testing
- `npm install gdc-common-utils-ts@^1.23.0`

## [1.12.0] - 2026-06-13

### Added
- Added portal-managed payment confirmation utilities in:
  - `src/utils/payment-confirmation.ts`
- Added embedded invoice bundle generation for commercial order responses in:
  - `src/utils/invoice-bundle.ts`
  - `docs/PORTAL_API_TO_GW_CORE.md`
- Added focused unit coverage for payment confirmation and commercial order
  invoice readback in:
  - `src/__tests__/unit/utils/payment-confirmation.test.ts`
  - `src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts`
  - `src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts`

### Changed
- Updated hosted organization and family/individual commercial order flows so
  persisted offer/order state can be reopened and the accepted order response
  now includes:
  - FHIR `Invoice`
  - `DocumentReference` PDF
  - `DocumentReference` structured JSON/XML
- Persisted commercial offer state for both employee and individual/member
  seat activation follow-up flows.
- Fixed `api:local-firestore-demo` so the local firestore profile starts with
  the same `ts-node` compiler option escaping used by the demo profile.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.22.0`.

### Testing
- `npm run type-check`
- `npm test -- --runInBand src/__tests__/unit/utils/payment-confirmation.test.ts src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts src/__tests__/unit/managers/IndividualManager.test.ts src/__tests__/unit/managers/EmployeeManager.test.ts`

## [1.11.1] - 2026-06-13

### Changed
- Added explicit `RelatedPerson/_purge` lifecycle handling in the individual
  surface, requiring the stored record to already be inactive and preserving
  the record with purge metadata instead of hard-deleting it.
- Aligned `RelatedPerson` processing with the canonical claims envelope by
  reading `resource.meta.claims` first while keeping legacy `entry.meta.claims`
  compatibility during migration.
- Extended `RelatedPerson` lifecycle writes to preserve canonical per-entry
  status from `resource.meta.status`, enabling inactive-state lifecycle updates
  to flow through the stored record shape.
- Hardened stored `RelatedPerson` normalization so purge/update flows can
  operate consistently whether the vault returns raw content or wrapped
  records.
- Published new DID service definitions for `RelatedPerson/_purge` on both
  `org.hl7.fhir.r4` and `org.hl7.fhir.api` individual endpoints.
- Added modular commercial/license read-model helpers in:
  - `src/utils/commercial-read-model.ts`
  - `src/utils/license-search.ts`
- Added `License/_search` support plus hosted/family `Offer/_search` and
  `Order/_search` readback so portal-facing flows can reopen persisted
  commercial state without inventing a separate service contract.
- Made the request body size limit explicit and configurable through
  `GW_REQUEST_BODY_LIMIT`, returning a clear `413` lifecycle-safe early error
  when large `Communication/_batch` payloads exceed the configured limit.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.21.0`.

### Testing
- `npm test -- RelatedPersonManager.test.ts request-validator.test.ts`

## [1.10.2] - 2026-06-11

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.20.2`.
- Updated `cloud_deploy.sh` so Cloud Run deployments can resolve versioned
  Artifact Registry image tags from `package.json` plus the current git SHA,
  and reuse a prebuilt local Docker image when `SKIP_BUILD=true`.

## [1.10.1] - 2026-06-11

### Changed
- Simplified the Docker image build so GW CORE no longer copies the deprecated
  local `gdc-sdk-client-ts` source tree into the builder/runtime image.
- Narrowed `EXTRA_TS_PATCH_DIRS` in the Docker build to the remaining shared
  local dependency (`gdc-common-utils-ts`), keeping local image creation aligned
  with the current dependency graph.

### Testing
- `./docker_build_local.sh`

## [1.10.0] - 2026-06-10

### Added
- Added an individual onboarding PDF draft flow in GW CORE so a controller can
  submit template bytes/reference plus KYC/form data and receive a filled PDF
  draft back as `DocumentReference` claims.
- Added shared onboarding draft generation helpers in:
  - `src/utils/individual-onboarding-pdf-draft.ts`
  - `src/utils/individual-organization-kyc.ts`
  - `src/utils/service-capability-claims.ts`
- Added focused coverage for:
  - onboarding PDF draft generation in `FamilyManager`
  - worker routing for `individual/pdf/DocumentReference/_create`

### Changed
- Integrated KYC normalization into the individual/family onboarding flow so
  GW CORE now merges claims with precedence:
  - raw claims
  - KYC-derived claims
  - PDF/form-derived claims
- Completed the GW CORE PDF field mapping for the pending onboarding fields,
  including subject birth/gender fields, consent date, and service-provider
  domain.
- Switched the onboarding draft route contract from `Action/_create` to the
  more accurate `DocumentReference/_create`, while keeping `Action` accepted
  temporarily inside the family manager for compatibility.
- Fixed worker routing so `DocumentReference/_create` requests under
  `individual/pdf` actually reach the family onboarding manager instead of the
  generic document manager.
- Updated tenant/host discovery capability publication and filtering so GW
  CORE accepts capabilities from both:
  - `Service.serviceType`
  - `Service.additionalType`
  during the discovery migration.
- Clarified `Service.additionalType` handling so compact HL7
  `ActReason` values such as
  `http://terminology.hl7.org/CodeSystem/v3-ActReason|METAMGT,HRESCH`
  are treated as purposes and no longer misread as provider discovery
  capabilities.
- Expanded the API/family integrator guides to document the onboarding PDF
  draft endpoint and the transitional discovery-capability semantics.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/worker.test.ts src/__tests__/managers/FamilyManager.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm run build`

## [1.9.0] - 2026-06-07

### Added
- Added consent-access blockchain registration support so consent ingestion can
  project one sanitized atomic rule per on-chain asset through a dedicated
  `registerConsentAccessBundle(...)` adapter path.
- Added Fabric write-capable blockchain adapters and local-memory/multi-adapter
  composition for progressive consent-access ledger integration:
  - `src/adapters/BlockchainAdapterFabric.ts`
  - `src/adapters/BlockchainAdapterMulti.ts`
- Added local Fabric bootstrap and smoke/demo support for GW CORE:
  - `npm run prepare:local-fabric-env`
  - `npm run api:local-fabric`
  - `npm run api:local-fabric-devnet`
- Added `local-network` as an explicit runtime network mode distinct from the
  shared `test-network` integration environment.

### Changed
- Normalized legacy plaintext API requests so managers always receive business
  payloads through `job.content.body`, matching the DIDComm path contract.
- Updated consent processing to derive canonical consent blockchain entries,
  persist FHIR CID mappings, and then register consent-access rules on Fabric
  using jurisdiction-group channel resolution.
- Regenerated Swagger/OpenAPI profile artifacts and updated bootstrap,
  discovery, and hosting/operator documentation around the Fabric/local-network
  flow.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.19.0`.

### Testing
- `npm test -- --watchman=false src/__tests__/managers/ConsentManager.test.ts`
- `npm run build`

## [1.8.5] - 2026-06-05

### Changed
- Fixed the GKE demo deployment probes to use `/host/ping` instead of the
  removed root host discovery alias `/host/.well-known/ping`, so new GW CORE
  revisions can become `Ready` after rollout.

### Testing
- GKE demo rollout inspection against the public deployment, including
  verification that the previous `1.8.4` pod was blocked by `404` on the old
  readiness probe path.

## [1.8.4] - 2026-06-05

### Changed
- Fixed GW CORE runtime public-origin resolution so deployed host and tenant
  discovery artifacts now use `HOST_PUBLIC_URL` when that is the public edge
  URL injected by GKE/configmap, instead of falling back to `localhost`.
- Fixed hosted DID service publication so tenant operational URLs do not
  duplicate `/{tenantId}/cds-{jurisdiction}/{version}/{sector}` when the
  existing runtime base URL already includes that contextual path with
  different casing.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/config/server-config.test.ts src/__tests__/unit/utils/did-document.test.ts src/__tests__/integration/wellKnownApi.test.ts src/__tests__/integration/hostDemoWellKnown.test.ts`

## [1.8.3] - 2026-06-05

### Changed
- Removed root host `/.well-known` discovery aliases from GW CORE.
- Host discovery artifacts now publish only under the scoped path:
  `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/...`
- Reserved `/host/ping` as the only root-level host liveness endpoint.
- Fixed hosted DID/DCAT publication so the public discovery surface no longer
  falls back to `localhost` when the deployment provides a public URL.
- Fixed hosted tenant service endpoint generation so operational URLs that
  already include `/{tenantId}/cds-{jurisdiction}/{version}/{sector}` do not
  duplicate that path in published DID services.
- Updated the demo GKE deploy config to export `HOST_DEPLOY_URL` from the
  static public edge URL, so host and tenant discovery artifacts publish the
  real public origin after deployment.

### Testing
- `npm test -- --watchman=false src/__tests__/integration/wellKnownApi.test.ts src/__tests__/integration/hostDemoWellKnown.test.ts src/__tests__/unit/utils/swagger-spec.test.ts`
- `npm test -- --watchman=false src/__tests__/unit/utils/did-document.test.ts src/__tests__/unit/managers/TenantsCacheManager.url.test.ts src/__tests__/integration/wellKnownApi.test.ts`

## [1.8.2] - 2026-06-05

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.18.1`.
- Aligned FHIR resource versioning with the clinical replay contract:
  - resource canonicalization for `versionId` now excludes top-level `id`,
    `meta`, and narrative `text`
  - the hash now uses multibase58btc SHA3-384 multihash bytes
  - `Communication` IPS projections now skip duplicate clinical section
    entries by resource `meta.versionId`, even when the replayed IPS changes
    document/container ids or dates
- Added explicit host coverage-scope configuration with `HOST_COVERAGE_SCOPE`,
  defaulting to `EU` when unset.
- Switched the host-scoped DSP discovery and ping surface from legal
  `jurisdiction` semantics to `hostCoverageScope` semantics:
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/ping`
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/dspace-version`
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/...`
- Aligned the host DID service publication and backend discovery DTOs with the
  same host coverage-scope contract while keeping tenant/provider discovery
  tenant-jurisdiction scoped.
- Updated all shipped env templates so deployments that previously used
  `HOST_JURISDICTION=EU` as a discovery scope now publish that meaning through
  `HOST_COVERAGE_SCOPE=EU`, while keeping `HOST_JURISDICTION` available for the
  host legal jurisdiction.
- Regenerated the local core-flow and Swagger/OpenAPI profile artifacts after
  the host coverage-scope configuration alignment.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/utils/fhir-versioning.test.ts src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/integration/medication-statement.api.test.ts`
- `npm test -- --watchman=false src/__tests__/integration/wellKnownApi.test.ts src/__tests__/unit/utils/swagger-spec.test.ts src/__tests__/unit/utils/dataspace.did-services.compliance.test.ts`
- `npm run build`

## [1.8.0] - 2026-06-04

### Added
- Added frontend-style `Communication` embedded consent readback coverage via
  `individual/org.hl7.fhir.api/Subject/_search` with attached FHIR `Parameters`,
  so one `Communication` can retrieve the subject-scoped `Consent` projections
  previously persisted from bundled consent attachments.
- Added reproducible local consent flow artifacts for:
  - bundled consent creation
  - consent readback through embedded `Subject/_search`

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.17.0`.
- Extended the local consent live artifacts to cover both:
  - bundled consent creation via `Communication/_batch`
  - consent readback via `Communication/_batch` forwarding to `Subject/_search`
- Aligned the canonical consent communication example with
  `resource.meta.claims` instead of legacy `entry.meta.claims`.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/unit/managers/IndividualManager.test.ts src/__tests__/unit/utils/services.test.ts src/__tests__/integration/consent.communication.api.test.ts`
- live/local `api:local-demo` + `demo:bootstrap-single-tenant` consent write/read verification via `Communication/_batch`

## [1.7.5] - 2026-06-04

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.16.0`.
- Clarified activation/OpenAPI guidance around key-binding semantics for:
  - `Organization.hasCredential.material`
  - `Person.hasCredential.material`
  - `SoftwareApplication.material`
- Clarified RFC 7638 JWK thumbprints and RFC 9278 URN representation in the
  activation-proof and integrator-guide text.
- Regenerated Swagger/OpenAPI profile artifacts after the documentation
  alignment.

## [1.7.3] - 2026-06-01

### Added
- Added a dedicated two-host autodiscovery smoke runbook and scripts for local
  `Alice` / `Bob` GW instances, including:
  - versioned env templates `env.alice.example` and `env.bob.example`
  - `scripts/run-alice-bob-local.sh`
  - `scripts/bootstrap-alice-bob-discovery.sh`
  - `scripts/smoke-alice-bob-autodiscovery.sh`

### Changed
- Migrated the local two-host autodiscovery smoke from legacy `/.well-known/dcat3/catalog`
  to the host-scoped DSP contract:
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/.well-known/dspace-version`
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/dsp/catalog/dcat.json`
- Clarified host ping semantics so GW CORE now documents two distinct checks:
  - `GET /host/.well-known/ping` for global host runtime liveness/readiness
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/.well-known/ping`
    for the host-scoped hosting/autodiscovery surface
- Extended the host discovery/runtime surface to accept the host-scoped ping
  path while keeping `/host/.well-known/ping` as a compatibility alias.
- Updated host autodiscovery publication to read `org.schema.Service.*` claims
  from the persisted tenant provider-service shape as well as top-level claims,
  so bootstrapped provider tenants are published correctly in live host catalogs.
- Extended `scripts/bootstrap-single-tenant.sh` so local smoke/bootstrap flows
  can explicitly set:
  - `org.schema.Service.url`
  - `org.schema.Service.areaServed`
  - `org.schema.Service.serviceType`
- Clarified the GW-to-ICA lifecycle documentation for:
  - hosting operator / tenant onboarding
  - `Token/_exchange`
  - `Device/_dcr`
  - CSR enrollment with ICA
  - tenant publication via host autodiscovery
- Removed the transitional tenant demo ICA CSR enrollment call so the current
  runtime model stays host-only for Fabric/X.509 enrollment.

## [1.7.1] - 2026-05-27

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.10.0`.
- Aligned tenant service-capability fixtures and discovery tests with the
  clearer shared `IndexReader` / `IndexProvider` naming while preserving the
  persisted token contract.

## [1.6.1] - 2026-05-26

### Fixed
- Docker runtime image now includes `artifacts/openapi-profiles`, so the published Swagger UI can fetch `openapi-core.json`, `openapi-compat.json`, and `openapi-extension.json` instead of failing with `Not Found`.

### Changed
- Added a root-level `gke-demo` deployment path for the current GW standalone demo, including IP-only `LoadBalancer` exposure, reusable local-image push with `SKIP_BUILD=true`, and minimal GKE manifests under `fabric-multicloud/k8s/gdc/`.

## [1.6.0] - 2026-05-26

### Changed
- Added `STORAGE_PROVIDER=supabase` support so GW can keep confidential indexed storage in PostgreSQL while storing uploaded files in Supabase Storage via `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.
- Standardized env template naming around visible `env.*.example` files, leaving `.env.*` names for private local copies only, with local runtime variants using `local-*` (`.env.local-demo`, `.env.local-postgres`) and the Supabase runtime using `cloud-*` (`.env.cloud-supabase`) to match the `npm run api:*` commands.
- Switched local and cloud runtime scripts from layered dotenv overlays to single full-profile `.env.*` files so each `npm run api:*` command now maps to one complete environment file.
- `docker_run_local.sh` now accepts `HOST_PORT`, `ENV_FILE`, `CONTAINER_NAME`, `IMAGE_NAME`, and `FORCE_RECREATE`, so local Docker runs no longer require hardcoded `8080` / `.env.local` edits.
- Added a first GKE deployment skeleton for the GW host/connector under `fabric-multicloud/k8s/gdc/`, explicitly separated from Fabric components and from `dataspace-ica-ts`, with a render/apply script driven by `K8S_NAMESPACE_GDC`, `GDC_IMAGE`, and `ICA_URL_*`.
- Extended the GKE GW skeleton to support the ICA-style public edge pattern: reserved static IP, GKE ingress, and Google-managed certificate.
- Added `demo-deploy.config.example` plus env-driven GKE GW rendering so demo deployments can reuse `.env.local` and stay on `mem` providers instead of forcing Firestore/GCS.
- Simplified the demo GKE GW deployment model so `dataspace-ica-ts` is no longer assumed to be co-deployed or reachable internally; only an optional external ICA URL remains.
- Extended the root `cloud_deploy.sh` entrypoint with a `gke-demo` mode so the current demo GKE deployment can be launched from the repo root instead of going through `fabric-multicloud` manually.
- Added `SKIP_BUILD=true` support to the root `cloud_deploy.sh` GKE demo path so an already-built local Docker image can be retagged and pushed without rebuilding.
- Simplified the GKE demo path to IP-only HTTP for the current phase: `LoadBalancer` Service with a reserved static IP, no domain, no managed certificate, and no ingress dependency.
- Core Swagger family-registration request bodies now expose two named examples in the selector: online PDF link and inline base64 PDF, so integrators can compare the two transport forms directly.
- Family registration signed-PDF onboarding now accepts HTTPS attachment links via `attachments[].data.links[0]` in addition to embedded base64, and the canonical Swagger/example fixture defaults to the online-link form.
- Demo/smoke shell scripts no longer define copied business payload JSON inline when a canonical TypeScript fixture/helper exists; portal route smoke and medication/IPS demo flows now render their payloads from shared TS sources and only apply runtime overrides in Bash.
- Portal web go/no-go automation/docs now explicitly describe the command as a route smoke check backed by canonical example fixtures, instead of ad-hoc handwritten payload snippets or local `dummy-*` values.
- Updated SMART token authorization to evaluate the full active consent set for the subject instead of the previous single-rule MVP match.
- Added explicit deny precedence over broader organization/jurisdiction coverage in the live SMART path.
- Extended subject-scoped `Bundle/_search` handling so `Communication` permission requests can be recovered by:
  - `Communication.identifier`
  - `thid`
  - linked `DocumentReference.contenthash`
- Updated SMART compatibility and docs index notes to reflect the current live consent-evaluation behavior.
- Clarified Swagger family-registration examples so `Service.termsOfService` defaults to an HTTPS URL and `org.schema` claims are documented in the default contextualized form, with `CLAIMS_IDENTITY_STORAGE_MODE=canonical` called out as the strict fully-qualified alternative.
- Added markdown sync markers plus a conformance test so canonical GW guide payloads stay aligned with `src/__tests__/data/example-payloads.ts` instead of drifting as copied markdown.
- Legal-organization registration compatibility now derives internal `alternateName` from `Organization.identifier.value` when omitted, keeping `v1.x` flows working while public examples teach `taxId`/`identifier.value` as the canonical external input.
- Canonical legal-organization examples now use `acme-id` and omit `Organization.alternateName`; local bootstrap follows the same convention.
- Swagger Global Flow Context now re-migrates legacy `tenantId` / `taxId` values back to canonical `taxTenantId=acme-id`, rebuilds stale panels, and re-derives `physicianOrg` / `individualDid` from the canonical context instead of preserving legacy `TaxNumber-acme` or old `api.acme.org` individual DID placeholders.
- Swagger Global Flow Context now also derives a hashed professional member DID (`physicianDid`) from `physicianEmail` + `physicianRole` under the canonical organization DID, instead of treating the organization DID as the professional actor DID.
- Swagger Global Flow Context now also derives an individual controller DID (`individualControllerDid`) from `individualControllerEmail` + `individualControllerRole`, keeping the subject DID (`individualDid`) separate from the family/controller actor DID.
- Canonical individual/family Swagger examples now use homogeneous `{{individualDid}}`, `{{physicianOrg}}`, and `{{physicianDid}}` placeholders across SMART, Consent, Communication, Composition, Observation, and RelatedPerson payloads.
- Canonical family/controller examples now separate the subject DID from the controller DID, with `RelatedPerson` and related onboarding payloads using `{{individualControllerDid}}` where the human controller signs as the family actor.
- Added a dedicated `v2.0` TODO document for the future tenant-identifier/vault-id migration instead of mixing that breaking redesign into current core behavior.
- Added `scripts/render-example-payload.mts` so demo/incremental scripts can render request payloads from the same canonical fixtures used by tests and Swagger, with only explicit parameter overrides.
- Employee onboarding now behaves as canonical upsert/reactivation by `Organization.owner.email + Organization.owner.hasOccupation.identifier.value`, returning an already-existing active member directly and reactivating an inactive matching member instead of creating duplicates.
- Family onboarding now accepts and normalizes the signed individual-registration PDF attachment into canonical claims before building the stored registration artifacts.
- Added a canonical `_transaction` alias for `individual/org.schema/Organization` service discovery and Swagger so individual organization flows can be exercised with the same onboarding semantics as the existing batch route.
- Legal-organization activation/discovery now treats `org.schema.Service.serviceType` as the canonical capability source for tenant DID publication and DCAT3 service offerings, with the docs and examples aligned around mandatory activation capabilities.
- Regenerated Swagger/OpenAPI profile artifacts and aligned route descriptions, bootstrap scripts, env defaults, and curl examples around canonical `acme-id`, contextualized `org.schema` claims, and the synchronized local example fixtures.
- Reorganized legacy top-level guides under `docs/`, expanded reading-order/README guidance, and documented the local example-sync workflow so the repo reflects the current source-of-truth layout.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.7.0`.
- Added local GW lifecycle documentation for SDK alignment:
  - `docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md`
  - `docs/90.L-LIFECYCLE_CURRENT_VS_TARGET.md`
- Clarified current GW CORE lifecycle semantics:
  - `individual/org.schema/Organization/_disable` disables the hosted individual/family record without releasing licenses
  - `individual/org.schema/Organization/_purge` requires prior inactive status, releases or disassociates licenses, and preserves the record for traceability
  - `entity/org.schema/Employee/_purge` requires prior inactive status, releases or disassociates licenses, and preserves the employee record for traceability
- Clarified target lifecycle normalization for future shared-package / SDK migration:
  - `_batch + POST` create
  - `_batch + PUT` resource update
  - `_batch + PATCH` lifecycle or partial operational update
  - `/_purge + POST` explicit purge command
- Clarified that `ConfidentialStorageDoc.status` is the canonical current lifecycle state and that blockchain lifecycle anchoring should use a derived status-change event instead of the raw confidential storage document.
- Centralized key domain lifecycle and license literals under `src/constants/domain.ts` to reduce hardcoded action, section, and licensing strings in managers and routing helpers.
- Added a deploy-path split in `cloud_deploy.sh` so the same entrypoint now supports both Cloud Run environments and a demo GKE deployment mode.
- Added a minimal GW GKE deployment skeleton under `fabric-multicloud/k8s/gdc/`, plus templated rendering/apply support in `fabric-multicloud/scripts/05-k8s-deploy-gdc.sh`.
- Added `demo-deploy.config.example` and updated local Docker/GKE helper scripts to support reproducible demo deployment inputs without hardcoding secrets into the repo.
- Updated the runtime image packaging so generated OpenAPI profile artifacts are copied into the final container image for Swagger UI profile selection.

### Testing
- Added/updated focused tests for:
  - Supabase storage adapter hashing, upload wiring, and configuration parsing
  - family signed-PDF onboarding via remote HTTPS attachment link download
  - shell-script payload contract conformance (`dummy-*` regression guard + fixture-renderer usage)
  - SMART consent evaluation precedence
  - related-person SMART access
  - `Communication` lookup by identifier, thread id, and linked CID
  - legal-organization registration without explicit `alternateName`
  - Swagger Global Flow Context canonical helper fields and legacy migration hooks
  - employee create/reactivation upsert behavior
  - family registration signed-PDF claim extraction
  - individual organization transaction route exposure
  - synchronized markdown/shared-example conformance checks

## 1.5.1 - 2026-05-23

### Changed
- Aligned GW CORE activation, DID publication, discovery, and shared examples with the new shared package minor line.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.5.0`.
- Clarified canonical `_activate` semantics around `vp_token`, `controller.*`, and deprecated legacy credential side-fields.

### Testing
- Targeted activation/discovery/shared-example suites pass against the packaged shared dependency.

## 1.3.14 - 2026-05-21

### Tests
- Added TDD coverage for the core lifecycle split:
  - `Employee/_batch` create, deactivate, and not-found handling
  - `MedicationStatement/_batch` not-found route semantics
  - `CommunicationManager` tenant-resolution not-found handling
- Kept coverage focused on canonical core flow resources without introducing extension behavior.

## 1.3.13 - 2026-05-20

### Added
- Local process helpers:
  - `npm run local:close` (port `3000`)
  - `npm run docker:close` (port `8000`)
- Canonical occupation claim helper:
  - `src/utils/occupation.ts`

### Changed
- Demo tenant bootstrap now uses canonical representative-role claims:
  - `org.schema.Person.hasOccupation.identifier.additionalType = "v3-RoleCode"`
  - `org.schema.Person.hasOccupation.identifier.value = "RESPRSN"`
- Role-code parsing migrated to canonical occupation helper in:
  - `HostingManager`
  - `EmployeeManager`
  - `FamilyManager`

### Tests
- `npm run type-check`: pass.
- `npm run test:e2e`: pass (no failing suites; specs remain conditionally skipped when live E2E credentials are not configured).

## 1.3.12 - 2026-05-18

### Added
- `CommunicationManager` now persists a subject-scoped auditable communication channel record as `CommMsgExtended` under `individual_communications_*` sections.

### Changed
- GW now treats `CommMsgExtended` as the atomic confidential-channel event and `FHIR Communication` as its interoperable health projection.
- `DocumentReference` extraction from `Communication.payload.contentAttachment` is now an explicit one-attachment-per-record atomic projection for retrieval and secure-storage indexing.
- Subject-scoped communication channel records now expose canonical `Communication.content-reference` values pointing to referenced business resources and atomized `DocumentReference/<id>` records.

## 1.3.11 - 2026-05-18

### Changed
- Updated dependency to `gdc-common-utils-ts@^1.4.20`.
- Refreshed generated OpenAPI profile artifacts after the canonical representative-role alignment release.

## 1.3.10 - 2026-05-18

### Changed
- Adopted `gdc-common-utils-ts@^1.4.18` shared role normalization for activation representative validation.
- Canonical legal-representative occupation format is now `credentialSubject.hasOccupation.identifier.value = "RESPRSN"` (legacy tokens still accepted by normalizer).

## 1.3.9 - 2026-05-18

### Changed
- Activation representative validation now consumes shared `gdc-common-utils-ts` policy helpers instead of local duplicated parsing logic.
- Core integration doc now states canonical member DID composition: owner DID prefix + `:member:<member-id>:<role>`.

## 1.3.8 - 2026-05-18

### Changed
- Enforced legal-representative VC security linkage in `_activate` trust validation:
  - `credentialSubject.memberOf.taxID` must match organization credential tax ID.
  - `credentialSubject.hasOccupation` must include `RESPRSN` (Responsible Party).
  - `credentialSubject.hasCredential.material` is now required.
- Core API examples are now VP-JSON-first for activation (`body.data[].vp`) to keep proofs readable/auditable; tests can derive `vp_token` JWT from that canonical VP object.

## 1.3.7 - 2026-05-06

### Changed
- Documented `_activate` trust validation contract aligned with ICA credentials:
  - representative VC must be trusted from ICA signature chain,
  - `org.schema.Person.memberOf.taxID` must match the organization tenant canonical identifier (`Organization.identifier.value`),
  - `org.schema.Person.hasCredential.material` is the source of representative signing-key binding for VP signature checks.
- Clarified authentication semantics for onboarding:
  - `vp_token` is a proof payload inside the activation message body,
  - HTTP `Authorization: Bearer` remains a transport/auth header concern and is not the VP itself.

## 1.3.6 - 2026-05-05

### Added
- Added strict license-gating mode for employee creation with `MANDATORY_LICENSE_CREATING_MEMBERS=true`.
- In strict mode, `Employee/_batch` now processes entries sequentially and returns per-entry `409 + OperationOutcome` when seats are exhausted, while keeping prior successful entries.

### Changed
- Kept backward compatibility when strict mode is disabled: legacy `Employee-license-offer-v1.0` behavior remains unchanged.
- Updated controller/practitioner step-by-step docs and endpoint/path clarifications for onboarding vs runtime identity/token flows.

### Tests
- Added unit coverage for partial batch behavior under mandatory license mode (success prefix, failure suffix).

## 1.3.5 - 2026-05-04

### Changed
- Activation trust now accepts organization credential resolved from `vp_token` (Verifiable Presentation) without requiring representative credential as mandatory input.
- Hosting activation parsing now resolves `OrganizationCredential` / `LegalOrganizationCredential` (and optional representative credential) from `vp_token.verifiableCredential[]`.
- Host onboarding/integration contract aligned to `/host/...` routes with `auth` security model for current gateway flows (OIDC pre-DCR and SMART post-DCR).
- Documentation alignment clarified for cross-service namespace consistency:
  - Gateway: `/host/...`
  - ICA: `/ica/...`
  - DataConv: `/publisher/...`

### Tests
- Added unit coverage for VP-based organization credential extraction in hosting activation flow.
- Updated activation trust adapter tests to validate activation without representative credential.

## 1.3.4 - 2026-04-30

### Changed

- Included sector/business routing consistency, docs updates, and alignment utilities/tests from upstream evolution scope.

### Fixed

- 2026-04-11 12:10: Fixed Stripe webhook endpoint mounting so the public route is `/webhooks/stripe` (previously double-prefixed as `/webhooks/webhooks/stripe`), and added integration coverage for route resolution.

## [1.3.0] - 2026-04-11

### Added

- 2026-04-11: Added PostgreSQL-backed vault repository support with schema bootstrap, runtime wiring for `DB_PROVIDER=postgres`, and integration coverage using `pg-mem` for secure indexed confidential storage queries.
- 2026-04-11: Added `.env.local.postgres` overrides and `npm run api:local-postgres` for running the API locally against PostgreSQL without duplicating the full local environment file.
- 2026-04-11: Added `docker-compose.postgres.yml` plus local helper scripts to start, stop, and inspect a dedicated PostgreSQL container for the new vault provider.
- 2026-04-11: Added `db:local-postgres:reset`; the PostgreSQL vault schema is auto-created by the API at startup, so no manual init SQL is required for this initial adapter rollout.

## [1.2.0] - 2026-03-14

### Added

- OneHealth sector model based on `MAINSECTOR` + `SUBSECTORSALLOWED`, with synthetic sectors for `animal-*` and `health-*`.
- OneHealth FHIR and research routing for care, index, tech, and digital twin ingestion use cases.
- Research digital twin ingestion endpoints for `Composition/_batch` in `digitaltwin/org.hl7.fhir.api` and `digitaltwin/org.hl7.fhir.r4`.
- Host onboarding contract for `Organization/_activate` and `_activate-response` in API docs, swagger, and service discovery.
- Error helpers to keep early 4xx/5xx responses compatible with DIDComm/FHIR clients.

### Changed

- Host and tenant service generation now derives capabilities from sector semantics instead of a fixed legacy FHIR sector list.
- OneHealth docs and examples now cover animal and human health channels, research ingestion, and the ICA-first activation target flow.
- OIDC/SMART discovery and legacy signing defaults remain aligned on ES384 / P-384 for compatibility with the current backend.

### Fixed

- FHIR ingestion and polling behavior for legacy raw FHIR mode now stays asynchronous while preserving raw FHIR poll responses.
- Request validation, swagger generation, and manager coverage were extended for the new OneHealth routes and sectors.

### Known limitations

- `Organization/_activate` is published as an exposed contract, but worker-side activation is still a placeholder and returns `NotSupported`.

### Added

- Secure Key Resolution for Standard Crypto Flow: When a protected request arrives without an embedded `jwk` in the JWE and JWS protected header, KmsService now follows a secure query pattern:

  It derives the tenant's vaultId from the issuer's (iss) DID (e.g., an employee or customer DID).
  
  It uses its internal HMAC capabilities to protect the query parameters (i.e., the key identifier `kid` as attribute name).
  
  It queries the VaultRepository using these protected parameters to find the corresponding encrypted document.
  
  It decrypts the employee/customer configuration document just-in-time to retrieve the public key required (jwk) to encrypt the future response.

-   **New Person Discovery Feature:** Implemented a new asynchronous `_discovery` action to find a Person's `did:web` using private identifiers.
    -   The new endpoint is `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/test-network/org.schema/Person/_discovery`.
    -   The backend handles URN construction, hashing, and dynamic routing to the appropriate blockchain channel (`<sector>-eu` or `<sector>-global`) and smart contract (`discovery-person`) based on "convention over configuration".
    -   Introduced `NetworkActionsController` and a dedicated `networkRouter` to manage this new API section.
    -   Added new utility modules to support the discovery logic: `identifier-parser.ts`, `jurisdiction.ts`, and identifier-channel helpers.
-   **Contextualized Claims Normalization:** Added claim normalization + deterministic ordering for contextualized schema.org claims (see `src/utils/claims.ts`) to support future canonical hashing.
-   **Family Onboarding (Offer/Order):** Added `FamilyManager` and data fixtures to support family (household) registration with the same Offer/Order pattern used for tenant onboarding.
-   **Sandbox-Safe Integration Test Harness:** Added `invokeExpress` helper to run integration tests without binding a TCP port (required in sandboxed environments).
-   **SMART Token Issuance (Async):** Added `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token` job flow with polling via `.../identity/openid/smart/_batch-response`, including consent-rule matching by actor (jurisdiction URN / did:web / email), role, purpose, and requested LOINC sections.
-   **Consent Rule Fixtures:** Added `src/__tests__/data/consent-rules.data.ts` and unit/integration coverage for consent-based SMART token gating.

### Changed

-   **Refactored `CustomerManager`:** The manager now handles the new `_discovery` action alongside the existing `_batch` action.
    -   The discovery logic is optimized to group multiple identifier hashes (e.g., from `NNES` and alternate identifiers for the same person) and query the blockchain in a single, efficient batch call per channel target.
    -   The smart contract is expected to implement a "first match wins" optimization for these batch queries.
-   **Updated `IBlockchainAdapter`:** The interface was changed from `discoverDidByHash` to the batch-aware `discoverDidsByHashes` to support the performance optimization.
-   **Updated Service Definitions (`services.ts`):**
-   **DID Service ID Convention (SDK parity):** DID Document service IDs now follow `#<section>:<format>:<resourceType>:<action>` via `generateServiceId()` (and request validation supports both config selectors and DID fragments).
-   **Backend Crypto Adapter (Node):** `CryptographyService` is now instantiated with a Node `ICryptoHelper` adapter (random UUIDs/bytes + SHA/SHA3 digests) to match the SDK’s platform-adapter approach.
-   **Customer → Individual:** Renamed the worker registry key from `customerManager` to `individualManager` and renamed the unit test file to `IndividualManager.test.ts`.
-   **Secure API Routing:** Path params are now authoritative when building the async `jobRequest` (prevents decoded payload fields from overriding `tenantId/sector/section/resourceType`).
-   **OIDC Service Definitions:** Split OIDC service templates so `Device/_dcr` and `smart/token` don’t cross-combine (no accidental `Smart/_dcr` or `Device/token` in DID service multiplexing).
-   **Test Environment Isolation:** `src/server.ts` no longer loads `.env.local` (or initializes Firebase) under Jest, and Jest now sets safe default host env vars for `startServer()`-based integration tests.

### Fixed

-   **Architectural Flaw in Asynchronous Job Processing:** Corrected a major flaw in how the system handles plaintext (`application/json`) asynchronous requests. The new, secure flow is as follows:
    -   **Problem:** Plaintext requests were generating plaintext responses, which were stored directly in the response store, breaking the polling handler which expects all artifacts to be encrypted JWEs.
    -   **Solution:** All job results are now **always** stored as encrypted JWEs. For plaintext requests where the client does not provide a public key, the system uses an **"encrypt-to-self"** pattern: the `Worker` encrypts the response using the public key of the tenant processing the job (or for the new tenant in the case of onboarding).
    -   The `pollingHandler` is now responsible for inspecting the original request's `Content-Type`. If it was a JSON-based type, the handler **decrypts** the stored JWE just-in-time before sending the final plaintext JSON payload back to the client. This ensures clients that send JSON receive JSON, abstracting the internal security measures.

-   **Corrected Onboarding Tests:** Fixed all failing unit tests for `CustomerManager` by aligning the test data's job action with the manager's expectation.
-   **Resolved `tsc` Compilation Errors**
-   **BYOK End-to-End Flow:** Fixed `byok-dcr` integration test by making the flow complete Offer→Order and making polling robust.
-   **CORS + In-Memory Express Invocation:** Fixed crashes in integration tests caused by `cors/vary` expecting Node `ServerResponse` header APIs.
-   **Hosting Offer/Order:** Fixed Offer identifier handling, ensured tenant config retains required claims, and persisted an indexable admin employee record so secure key resolution can find `kid/skid`.
-   **KMS Key Metadata:** Ensured managed JWKs are marked with `use: 'sig'|'enc'` so downstream key selection works reliably.
-   **DCR Example Data:** Updated test fixtures so the DCR `code` is a valid UUID, aligning with `DeviceRegistrationManager` activation-code validation.

### Internal

-   **Unit Tests:** Added a comprehensive suite of unit tests for the new batch discovery logic in `CustomerManager.test.ts`.
-   **End-to-End Test:** Added a new test case (`Part 8`) to the main integration test suite (`end-to-end-flow.test.ts`). This test verifies the full, asynchronous submit-and-poll flow for the `_discovery` endpoint using a real, encrypted JWE payload.
-   **Documentation:** Created a new, detailed architecture document for the discovery feature at `docs/03-IDENTITY-AND-TRUST/03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md`, which includes a Mermaid sequence diagram illustrating the entire flow, and ``.
-   **Code Cleanup:** Removed the obsolete `CustomerDiscoveryManager` and its test file, as its logic was consolidated into `CustomerManager`. Disabled verbose cryptographic logs to improve test readability.
-   **Integration Suite Hardening:** Updated Jest config and integration tests to avoid sandbox-incompatible e2e/firestore runs and to use in-memory Express invocation.
-   **Docs:** Updated `docs/API_INTEGRATORS_GUIDE.md` with contextualized claims normalization rules and license gating notes.

## [Unreleased]

### Added
- Integration coverage for `Bundle/_search` DocumentReference retrieval by canonical hash claim:
  - `DocumentReference?subject=<did>&contenthash=<cid>`
  - response contract validated via `DocumentReference-search-response-v1.0`.

### Changed
- Communication attachment projection now separates:
  - `DocumentReference.identifier` as logical UUID/URN identifier,
  - `DocumentReference.contenthash` as content hash/CID for retrieval/integrity.
- Bundle search parser now prioritizes `contenthash` query/filter names and keeps legacy hash aliases for temporary compatibility.
- API integrator guide updated with canonical `DocumentReference.contenthash` field contract.

### Added
- **End-to-End Test for Person Onboarding**: A comprehensive E2E test (`Part 3`) now verifies the entire asynchronous flow for creating a `Person` resource, including job submission (`202 Accepted`), secure polling with `POST` (`200 OK`), and final response validation (`201 Created`).
- **TDD Roadmap for Future Features**: Added tests (`Part 4` for `Composition` and `Part 5` for `Communication`) in the E2E flow. These tests act as an executable specification and clear roadmap for the next development steps.
- **`CustomerManager` Integration**: Fully integrated the `CustomerManager` into the server initialization, connecting it to the `Worker` via the `ManagerRegistry`.

### Changed
- **Corrected Tenant Service Configuration**: Updated `utils/services.ts` to correctly define the service endpoint for the `individual` section (previously `index`), enabling the `Person`, `Composition`, `Communication`, and `Subscription` resource types.
- **Refactored `CredentialManager` Dependencies**: The `CredentialManager` constructor now correctly receives only the `hostExternalDomain` string instead of the entire `IServerConfig` object, adhering to dependency injection best practices.
- **Standardized Manager Logic**: Refactored `CustomerManager` to correctly derive the `vaultId` from the `job.sector` and `job.tenantId` properties, following the established architectural pattern where managers (not the router) are responsible for this logic.

### Fixed
- **Critical Bug in Job Context**: Fixed a critical bug where `CustomerManager` was incorrectly interpreting `job.tenantId` as the `vaultId`, leading to "Tenant not found" errors. The manager now correctly reconstructs the `vaultId`..
- **Module Interoperability Issues**: Standardized the import and usage of CommonJS modules like `express` across the application (`server.ts`, `discovery.ts`) to use the `import * as name` and `name.default()` pattern, resolving persistent compilation and runtime errors.
- **E2E Test Polling Logic**: Corrected the E2E test to use the secure `POST` method with the `thid` in the `body` for polling, aligning with the server's implementation.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2025-10-15-0126]

### SECURITY

-   **Formalized the Inbound Request Security Model:** A clear, two-phase security model has been implemented and documented, strictly separating **Authentication** from **Authorization**.
    -   **Phase 1 (Authentication):** The API Controller (`api.ts`) is now solely responsible for authenticating requests. It uses a `try...catch` block to call the `KmsService`. If signature verification fails, the KMS throws an error, and the API immediately returns a **`401 Unauthorized`**.
    -   **Phase 2 (Authorization):** Business-level authorization (e.g., checking if a signer is a permitted "controller" via `assertionMethod` for a specific action like Fabric onboarding) is now the responsibility of the asynchronous **Worker** and its respective **Manager**. The API controller no longer handles this logic.
-   Added a critical security integration test (`should return 401 Unauthorized...`) to ensure the API correctly handles cryptographic signature failures from the KMS.

### CHANGED

-   **Improved Job Name Uniqueness:** The `createJobName` function now uses the unique `vaultId` (e.g., "health-care_acme") to generate the job name, preventing potential collisions between tenants with the same `alternateName` in different sectors.
-   **Clarified Naming Convention:** Refactored `createJobName` and `parseJobName` in `src/utils/naming.ts` to use the parameter `jobContextId` instead of the ambiguous `tenantId`, and updated documentation to clarify that this ID must be the `vaultId`.
-   **Refined Test Suite Logic:** Integration tests for API endpoints (`employeeApi.test.ts`, `networkEnrollmentApi.test.ts`) have been simplified to follow the DRY principle. They now focus on verifying their specific endpoint integration, while the detailed mechanics of job creation are exhaustively tested in `pingApi.test.ts`.

### FIXED

-   **Fixed the `tenantId` in the `JobRequest` to preserve the original path parameter:** A critical bug was fixed in the API controller where the `jobRequest.tenantId` (which should be the tenant's `alternateName` from the URL) was being incorrectly overwritten with the internal `vaultId`. The `JobRequest` now correctly preserves the raw path parameters for the worker to process.
-   **Corrected Job Name Creation:** Fixed a bug in `createJobName` that was incorrectly stripping the leading underscore from actions (e.g., `_batch` became `batch`).
-   **Repaired All Integration Tests:** Aligned `pingApi.test.ts`, `employeeApi.test.ts`, and the original `networkEnrollmentApi.test.ts` with the corrected architecture, ensuring the entire test suite passes.

### Added

-   **Enhanced Architectural Documentation:** Updated `ARCHITECTURE-OVERVIEW.md` and `DEVELOPER_GUIDE.md` to reflect the new security model, the separation of AuthN/AuthZ, and the correct data flow from the API controller to the worker.

## [20251014-1710]

### Added
- **TDD-Driven URL Utilities**:
  - Created a new unit-tested `getBaseUrlFromDidWeb` utility in `did.ts` to correctly parse `did:web` identifiers, including those with percent-encoded ports (e.g., `localhost%3A3000`).
  - Implemented a new, fully unit-tested `getTenantDomainUrl` method in `TenantsCacheManager` using a TDD approach. This method provides the canonical service URL for a tenant, prioritizing their external domain and falling back to the gateway's hosted URL.

### Changed
- **Major Architectural Refactoring of Discovery Service**:
  - The system now correctly derives a tenant's hosted URL from the host's own `did:web` identifier, making the `TenantsCacheManager` self-reliant and architecturally sound.
  - The `discovery.ts` router and its `resolveTenant` middleware were completely refactored to remove dependencies on internal configuration objects, improving encapsulation and security. The router now correctly handles the `/:tenantId/cds.../.well-known/did.json` path.
- **`TenantsCacheManager` Naming**: Renamed `getTenantUrn` to the more descriptive `getTenantIdentifierUrn` across the entire codebase for clarity.

### Fixed
- **Critical Security Fix in Ping Handler**:
  - Refactored the `ping.handler.ts` to derive the JWT `iss` (issuer) claim from the request's `Host` header.
  - This corrects a major architectural flaw and ensures that the identity in a discovery response matches the domain the client is interacting with, adhering to `did:web` security principles.
- **Test Suite Failures**:
  - Correctly implemented the updated `IKmsService` interface in `DemoKmsService`, `KmsService`, and `kms.mock.ts`.
  - Added the `type` property to the `IndexedAttribute` model to preserve data semantics during HMAC protection.
  - Fixed dependency injection in `PingManager.test.ts`.
  - Replaced the obsolete `DidDocumentBuilder.test.ts` with `did-document.test.ts` and created a new, correct integration test for the Well-Known API endpoint (`wellKnownApi.test.ts`).



### Added
- **Batch Processing & Identifier Generation in `CustomerManager`**:
  - Re-architected `CustomerManager` to correctly process `_batch` requests by handling each entry as a discrete customer creation.
  - Implemented logic to automatically generate a new `urn:uuid:...` identifier if an entry is submitted without one (User Story 1: Self-Onboarding).
  - Implemented logic to aggregate claims from multiple batch entries that share the same anchor `identifier` into a single, unified customer record (User Story 2: Professional Onboarding).
- **Canonical Customer Public ID**:
  - `CustomerManager` now enforces the creation of a canonical public identifier for customers based on the pattern: `urn:...:individual:multibase:z<base58btc(uuid)>`.
  - Added a new `uuidToBytes` utility to correctly convert UUID strings into 16-byte arrays for encoding.

### Fixed
- **`uuid` Library Mocking**: Corrected the Jest mock for the `uuid` library in `CustomerManager.test.ts` to include the `validate` function.
- **Corrected `vc.id` Generation**:
  - Refactored the `vc-id` utility to correctly implement the "Versioned Credential ID" pattern: `z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))`.
  - Removed all problematic `multiformats` dependencies and replaced them with a self-contained `base-x` implementation to resolve persistent module resolution failures.
- **Enforced `credentialSubject.identifier` Usage**:
  - Updated `CredentialManager` to use `credentialSubject.identifier` for the subject's stable URN, adhering to the documented "Golden Rule" and W3C best practices.
  - Corrected the `CredentialManager.test.ts` suite to validate the `identifier` field, not the `id` field, in the `credentialSubject`.

### Added
- **Created Structured Documentation Hub**:
  - Consolidated all architectural and guide markdown files into a new, organized `/docs` directory with a numbered, thematic structure.
  - Created a new `docs/01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md` to formally document the mandatory patterns for VC ID generation, subject identification, and issuance formats.


### Changed
- **Re-architected `CredentialManager`:**
  - Refactored `CredentialManager` to be a generic, low-level credential issuance engine with a core `createAndSignVc` private method. It is no longer a public-facing manager that handles jobs directly, but an internal service invoked by other managers.
  - Aligned the manager's architecture with modern project patterns, ensuring it throws `ManagerError` on failure, to be caught by the calling business-logic manager.
- **Unified Indexed Attribute Types:**
  - Corrected the type signature for `IKmsService.protectAttributesNameAndValue` to return `Promise<IndexedAttribute[]>` instead of `ParamAttribute[]`, reflecting the transformation that occurs.
  - Refactored `CustomerManager` and `CredentialManager` to use the correct `ParameterData` type when preparing indexed attributes, eliminating type mismatches and manual mapping.

### Fixed
- **Fixed Critical Security Vulnerability:** Removed logic in `CredentialManager` that incorrectly decrypted a tenant's entire sensitive `EntityConfig`, preventing a major data exposure vulnerability. The manager now only works with pre-validated public claims.
- **Fixed `CredentialManager.test.ts`:**
  - Completely rewrote the test suite to align with the new, secure architecture.
  - Added test cases for `issueOrganizationSelfDescription` (signed by host) and `issueEmployeeCredential` (signed by tenant).
  - Added tests for secure storage (`storeCredential`) and retrieval (`searchCredential`), including mocking the repository's `query` method.
  - Corrected all `tsc` and `jest` errors.

### Added
- **Added `parseValidityPeriod` Utility:** Created and tested a new time utility at `src/utils/time.ts` to parse human-readable period strings (e.g., "1y", "5m") into `Date` objects, ensuring all operations are UTC-safe.


### Added

-   **Sovereign Identity Architecture:** Introduced a new identity model based on semantic URNs and Verifiable Credentials (VCs) to align with SSI, Gaia-X, and IDS principles.
-   **`ARCHITECTURE_PATTERNS.md`:** Created a canonical document for architectural patterns, including a detailed section on the new Sovereign Identity model.
-   **`TenantsCacheManager.getTenantUrn()`:** Added a new, efficient method to resolve a tenant's internal ID to their sovereign URN.
-   **`TenantsCacheManager.getDidServiceConfig()`:** Added a new, efficient method to retrieve only the DID service configuration for a tenant.

### Changed

-   **`EmployeeManager`:** Refactored to use the new URN-based identity model. It now constructs hierarchical URNs for employees based on the parent organization's URN.
-   **`EmployeeManager`:** Now retrieves the tenant's URN via `TenantsCacheManager` instead of requiring access to the full tenant configuration.
-   The issuer (`iss`) in API responses generated by `EmployeeManager` is now the tenant's sovereign URN.

### Deprecated

-   **`TenantsCacheManager.getConfig()`:** This method has been deprecated and will be removed. It exposed the entire `TenantConfig` object, violating the principle of least privilege. Use `getTenantUrn()` or `getDidServiceConfig()` instead.

### Removed

-   Removed direct dependency on `IServerConfig` from `EmployeeManager`. The required data is now provided by `TenantsCacheManager`.
