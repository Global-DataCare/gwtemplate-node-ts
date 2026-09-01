# Changelog

## [Unreleased]

- Publish the validated GW CORE `1.23.9` image built from commit `cc1cfdb` to
  the public GHCR package and pin every public host guide to its immutable OCI
  manifest digest.

- Require host commercial routes to carry the deployment's exact
  `networkKind`. The shared segment is `businessSectorOrNetworkKind`: tenant
  routes carry a business sector, while `test`, `local-network`,
  `test-network`, and `network` remain distinct host network stages.
- Add adapter-neutral regressions proving that neither a tenant business sector
  nor in-memory `test` can select a `test-network` host Order route.

- Remove the obsolete dated repository roadmap and all internal-planning and
  TODO links from the public package README. Keep CBOR only as a code-verified
  internal backlog item; other genuine compatibility gaps remain documented
  outside the package landing page.

- Clarify on the public package-facing README that the portable open-source
  host profile uses PostgreSQL and IPFS through a private Kubo node, while
  Firestore/GCS is retained only for legacy and demonstration compatibility.

- Promote the validated GW CORE `1.23.7` image built from commit `9e2be08` to
  the public GHCR package and pin every public host guide to its immutable OCI
  digest. The independently managed CCAAS runtime digest remains unchanged,
  and public handoff documentation now uses formal deliverable terminology.

## [1.23.8] - 2026-08-31

- Add the shared active-tenant `Offer/_create` contract for professional seats;
  controllers request quantity while GW authors and protects the commercial
  terms for the existing host `Order/_batch` continuation.
- Bind established DCR actors to either their exact DID subject or the verified
  email/telephone identifier embedded in the canonical professional DID. An
  external identity-provider account id is never treated as a DID.
- Resolve host-routed Order controller custody through the canonical tenant
  registry when the DID contains an official organization identifier. This is
  adapter-neutral and prevents Firestore, PostgreSQL, memory or future vault
  repositories from falling back to host custody.
- Replace the permissive employee-flow integration outcome with an explicit
  Offer, Order, KMS restart and successful employee creation contract.

## [1.23.7] - 2026-08-31

- Normalize signed encrypted profile-activation requests into the manager body
  contract only after signature verification, restoring high-level SDK
  `Token/_exchange` and DCR interoperability.
- Resolve contextualized `Order.acceptedOffer.identifier` claims and authorize
  pre-DCR organization transactions and Orders only with the controller keys
  declared by the reviewed transaction or protected pending Offer. An incoming
  envelope JWK is not an authority source for either continuation.

- Add separate public Spanish runbooks for local audit evidence, data-space ICA
  migration/promotion, and real host rollout through test-network and
  production. Add a high-level host bootstrap assistant that generates the
  host public DID and requests the governed HostingServiceCredential without
  requiring operators to construct JWS or HTTP payloads manually.

- Added an executable CORE contract manifest and high-level test-layout guide so derived gateways can distinguish shared contracts from product-only extensions without relying on matching test counts.

- Require locally authored clinical projections to match the authenticated
  actor before create or update, while preserving external `urn:*` IPS authors
  as immutable source provenance. Consent and research-access integration tests
  now use a deterministically verified actor instead of an anonymous demo
  bearer.
- Add a high-level authenticated-clinical-author 101 and SDK-only examples for
  IPS import and typed clinical section updates.

- Include the sibling ICA's open-source Firestore/GCS to PostgreSQL/IPFS
  migration gate in the reproducible production-readiness collector. Public
  evidence uses synthetic data, proves PostgreSQL/CID rereads and digest
  reconciliation, and excludes real credentials, signed PDFs and keys.

- Make the synthetic IPS ingestion fixture declare its canonical external
  author URN, so the high-level example preserves source provenance instead
  of deriving authorship from an unauthenticated demo bearer.

- Exclude the complete generated local Fabric workspace from the GW CORE
  Docker build context. Reproducibility sources remain tracked, while enrolled
  identities, channel artifacts and generated chaincode workspaces never enter
  the service-image build context.

- Consume the shared emergency-access policy and subject-kind matcher contract
  from `gdc-common-utils-ts@2.6.2`. CORE now owns only authorization
  orchestration, persistence and audit; derived domains inject exact identifier
  matchers without adding deployment-specific formats to this repository.
- Remove deployment-specific names, hostnames, route aliases and identifier
  formats from the affected CORE documentation, examples, tests and local
  skill guidance. Shared test coverage now uses canonical fixtures and proves
  that a domain matcher can be injected without changing CORE policy.

- Document the public `gdc-host` OCI chart and the provider-neutral Fabric ICA
  connectivity, host-local MSP/TLS enrollment, Kubernetes Secret and Helm
  installation handoff. Keep registrar identities, grants, private endpoints
  and provider inventories outside the public repository.

- Add repository-local release and test discipline covering branch/merge
  evidence, canonical shared fixtures and types, layered test boundaries,
  neutral shared artifacts and verified immutable release promotion.

- Document the reusable Next.js BFF identity-evidence API, including multiple
  controller identifiers, subject editing,
  self/worker uploads, professional attestations, ICA certificate-trust
  adapters, actor-facade boundaries and honest implemented-versus-pending
  status.
- Record an implemented reference-provider `list`/`prepareDeclaration`/
  `upload`/`verifySignaturePdf` facade and fixed-origin downstream proxy as
  extension scope, while keeping organization-worker and professional
  attestation contracts explicitly pending and outside GW CORE behavior.

- Clarify that organization-controller activation codes are GW-owned annual
  licence credentials returned by Order and consumed by exchange before DCR,
  not ten-minute portal/PDF OTPs. Document future Test Network email delivery,
  production postal delivery, one-month expiry notice and renewal work without
  changing the current authorization endpoint behavior.

- Document the public immutable GHCR manifests for GW CORE and the separate
  nine-contract CCAAS host runtime across the repository entry point, Helm
  guide and Spanish deliverables; keep deployment-specific CCAAS package IDs
  generated from each exact release address.

- Accept `Bundle.type=batch` clinical commands attached to `Communication` with
  independent per-entry create/delete results. Persist the verified DIDComm
  issuer as creator evidence; only that creator may delete the subject-scoped
  record by `resource.id`. `request.ifMatch` is optional, but when present its
  weak ETag is enforced with `412` on a stale version; one failed entry never
  rolls back another successful entry. Deleting an erroneous source record also
  removes its correlated digital-twin projection when secondary use is active.

- Separate the emergency `ETREAT` Consent period from each break-glass SMART
  token. Persist and anchor one Consent for up to 24 hours, send a minimized
  FHIR Communication to the controller mailbox, and reuse it for independently
  audited read-only tokens lasting at most 15 minutes. Publish requester
  organization/jurisdiction while hashing the professional identity.
  Artifact registration now owns its canonical `artifact-sc` target instead
  of accepting caller-selected or environment-fallback chaincode names.

- Allow an authenticated clinical-record creator to delete its own record
  without an `If-Match` condition, while still rejecting malformed or stale
  optional weak ETags and preserving subject and creator authorization checks.

- Remove the `openapi-extension.json` profile from GW CORE: the runtime exposes
  its complete specification and the `core`/`compat` views, while each derived
  solution maintains its own extensions outside this repository.

- Complete the local `consentaccess-sc` lifecycle for multi-host networks:
  install and approve the same package on every active MSP and target both
  peers when committing after the governed admission of `Host2MSP`.

- Fail the evidence environment gate when GW CORE, Dataspace CA or Dataspace
  ICA contain uncommitted tracked changes, preventing audit reports that do not
  correspond to reproducible revisions.

- Keep one Compose identity throughout evidence collection through
  `gdc-public`/`gdc-public-local-network`, so the Fabric, Docker and kind gates
  reuse exactly the same prepared local network.

- Reuse the Fabric peer image for in-cluster channel administration instead of
  importing the substantially larger Fabric tools image into kind, reducing
  the local evidence disk requirement without changing governance boundaries.

- Keep the first peer of a newly admitted host independent from foreign-MSP
  gossip bootstrap peers, allow sufficient configurable time for direct
  orderer catch-up and preserve exact-height verification before E2E traffic.

- Isolate concurrent evidence stacks by namespacing the ConsentAccess CCAAS
  container and by bridging kind to the configured Docker orderer host port
  instead of assuming port 7050 is available on the workstation.

- Allow explicit peer environment overrides in the reusable host chart. The
  local evidence profile bridges only the existing same-MSP bootstrap peer so
  lifecycle private data follows normal Fabric gossip while foreign-MSP
  bootstrap remains forbidden.

- Make the default Helm values schema-valid and runnable by selecting the
  supported in-memory replay-protection provider; production values continue
  to select Redis explicitly.

- Bind Fabric peer and GW client certificates through
  `gdc.hostCredentialSha256`: Fabric CA does not accept the `:` characters of a
  `urn:uuid` inside an `:ecert` attribute; authorization retains the complete
  identifier and certificates retain its verifiable SHA-256 digest.

- Run every evidence-runner gate in a subshell with `errexit`/`pipefail`, record
  `FAIL` on the first error and remove disposable Fabric CA SQLite databases
  before every clean reproduction.

- Make Fabric CA MSP/TLS helpers portable to Bash 3 when the local CA does not
  require `CA_TLS_CERT`, and test both expired-grant rejection and the two
  successful peer enrollments.

- Centralize the Stripe API version on `2025-12-15.clover`, compatible with the
  installed SDK, so type checking and image builds pass without divergence
  across webhooks, Checkout, billing and payment verification.

- Make hosting-provider onboarding auditable end to end: require a
  `HostingServiceCredential` on all three networks, limit the Fabric CA grant
  to two enrollments within an operational window, use a separate one-use grant
  for the GW client identity, generate keys inside the host, sanitize MSP/TLS
  packaging and reproducibly create all six Helm Secrets.

- Replace the static two-MSP Fabric genesis topology with a live dynamic
  admission proof: channels start with `Host1MSP`, governance signs and applies
  the admission of `Host2MSP`, and the second peer starts and joins both
  channels afterwards.

- Run the kind/Helm gate with the peer, all nine CCAAS runtimes and the GW
  client identity of the newly admitted `Host2MSP`, all bound to the same Host
  VC; the GW can no longer pass evidence while targeting Host2 but signing with
  Host1 material.

- Consolidate Markdown, HTML and Word artifacts under `deliverables/` and
  extend the public Spanish guide with separate commands for the authority,
  hosting provider, Kubernetes operator, reconciliation, OCI digests, CCAAS
  and acceptance.

- Deterministically generate all nine CCAAS packages and package IDs from the
  exact Helm release name and namespace, together with the values fragment and
  hash manifests consumed by governance.

- Validate Test Network scope exclusively through the signed
  `OrganizationTestNetworkCredential` and `TestNetworkCredential` types.
  schema.org subjects and evidence no longer require the non-standard
  `targetNetwork` field.

- Sanitize absolute home-directory paths in public evidence logs, represent
  them as `${HOME}` and fail the bundle if any `/Users/<user>` or
  `/home/<user>` path remains.

- Remove operational inventories, addresses and participant names from public
  skills; examples use portable fictional roles and values.

- Update the public Spanish Word guide under `deliverables/` with the complete
  kind/Helm proof: CCAAS lifecycle and GW E2E against the Kubernetes peer.

- Run the `Host2MSP` peer and CouchDB through the chart inside kind, enroll
  exclusive MSP/TLS material with the Fabric ICA, join the peer to both local
  channels and verify channels, CouchDB status and persistence after restarting
  the peer and GW.

- Actively wait for every Fabric peer to accept connections before joining it
  to channels, prevent startup races during clean reproduction and explicitly
  pin the bundled public Compose file and project so unrelated local
  infrastructure with historical names cannot contaminate the proof.

- Reproducibly install and approve nine CCAAS packages on the kind peer, target
  the GW exclusively at that peer and verify Consent, SMART and fresh
  endorsement capability after restarting the GW, peer and CCAAS runtimes.

- Prevent false Fabric revisions when two Consent rules contain semantically
  identical JSON with different property ordering.

- Require encrypted JWEs to be externalized to IPFS in the live Helm proof and
  fail explicitly if Kubernetes does not retain documents in PostgreSQL or
  blobs in IPFS, even when the collector runs the gate through a pipeline.

- Track the governance and onboarding `lib/*.mjs` modules required by public
  executables, and fail the gate when a clean checkout lacks any of these
  runtimes.

- Clarify canonical BFF naming: aggregate facades use `subject`,
  `organizations`, `employees`, `licenses` and `research`; operator functions
  use `/host/...`; admission governance uses `/test-network/...`. Product names
  are compatibility aliases only.
- Define the shared `individual` specialization without product-specific
  naming while preserving the same bootstrap, Order, controller DCR,
  Communication and secondary-use lifecycle.
- Update organization professional-seat documentation to the current
  high-level Offer/Order SDK lifecycle and authoritative readback.

- Document the temporary shared `legacy-v1` Firestore/KEK custody boundary
  between CORE development and a hosting-provider staging deployment, separately from their distinct
  token-verification modes.
- Make the SEDIA host deliverable self-contained in the public GW CORE
  repository: include the two-host Fabric `local-network`, generic
  authorization, enrollment and reconciliation scripts, and the reusable
  `gdc-host` Helm chart without depending on private infrastructure.
- Add a real isolated kind/Helm proof: load the already tested GW image, deploy
  PostgreSQL/IPFS, repeat the Consent and SMART E2E journeys over Fabric and
  prove recovery after restart. Keep `helm template` as an independent static
  contract.
- Route reproducible peer and orderer enrollments through the Fabric ICA and
  verify MSP and TLS chains against the disposable Root and its intermediate
  certificate.
- Include the preauthorized host's PDF-free Dataspace ICA contract in the
  aggregate evidence, with proven `HostingServiceCredential` issuance as both
  JSON VC and VC-JWT, without inventing PDF evidence.
- Remove absolute developer paths from local commands and tests; portable
  examples resolve paths from `${HOME}`.

- Make `iss` and `aud` the canonical trusted-provider configuration names,
  retain non-conflicting `issuer`/`audience` aliases, and fail startup when the
  two forms disagree.

- Allow one GW deployment/network to trust several OIDC identity providers
  through exact `iss` + `aud` entries. Provider keys are obtained through
  standard OpenID discovery, and an unverified issuer is used only to route to
  the verifier that then validates signature, issuer, audience and time claims.
- Sign PDF-free ICA host-verification requests with the GW host communication
  key so a server-preauthorized `local-network` host can reproduce onboarding
  without weakening ordinary PDF-based organization adhesion.

- Type the canonical `composition` embedded in every public Digital Twin
  `ResearchSubject/_search` result as FHIR `resourceType: "Composition"`.

- Make local-Fabric validation reproducible from a clean checkout by tracking
  every authored `chaincode/*-javascript/lib` runtime source and by failing the
  release-script contract test when an `index.js` import is absent from Git.
- Keep legacy tenants functional after the public Digital Twin aggregate moved
  from `Composition` to `ResearchSubject`: an existing read-only
  `Composition/_search` declaration now authorizes `ResearchSubject/_search`
  without tenant reactivation or DCR. Startup also republishes the current
  canonical tenant service catalog, removes obsolete resource-specific twin
  searches and preserves non-GW custom DID services. Subject Consent lookup
  also filters contextualized HRESCH rules by provider, action and source
  reference.
- Resolve same-tenant Digital Twin employment from extracted identity rather
  than whole-DID alias equality: parse the VAT/tax tenant id, email-derived
  `z...` and role from internal hosted or public organization DIDs, then require
  an active encrypted employee record in that tenant whose normalized email
  recomputes to the same `urn:multibase:z...`. The verified
  `EmployeeCredential` must bind that actor, role and `sameAs`; a crafted DID
  string alone cannot obtain the no-contract path.
- Align the immutable-image SMART/Fabric smoke with the public Digital Twin
  contract: it now searches `ResearchSubject/_search` and proves that every
  returned ResearchSubject carries its canonical Composition index.
- Add employee wallet replacement at `identity/auth/_recover`. A fresh
  email-OTP-marked Firebase token and the existing installation id must match
  one active employee seat. GW rotates the protected activation credential for
  server-side SDK consumption while preserving the employee identity/role;
  stale OTPs, wrong emails and unknown installations fail closed.

- Make `ResearchSubject` the single public Digital Twin aggregate: search and
  saved-selection lookup use FHIR `Parameters` at
  `digitaltwin/.../ResearchSubject/_search`, while each result exposes the
  canonical internal `Composition` index document. Preserve full hosted
  organization DIDs for `:employee:` and `:member:` SMART actors so same-tenant
  access does not incorrectly require an inter-tenant contract, and resolve a
  registered external `did:web` organization alias back to the canonical
  issuer tenant before making that decision.
- Replace the Git/SSH-pinned `gdc-common-utils-ts` source with the exact
  published `2.5.20` npm artifact. Both Docker stages now use `npm ci`, and the
  release test rejects Git, workspace and vendored dependency sources.
- Align the medication projection integration invariant with the private
  derived `__digitalTwinSearch.*` fields stored on each projected resource
  record, while continuing to reject exposed clinical text, display and note
  claims. They coexist on the same projected resource record, not a separate
  collection or public index, and Composition-wide discovery strips them from
  every returned or materialized FHIR resource.
- Make protected device licences readable through their HMAC activation-code
  index before employee exchange and DCR validation, while preserving encrypted
  persistence and synchronizing the active envelope status. Add manager
  regressions for both exchange and device registration.
- Require red-green-refactor flow contracts across unit, integration and E2E
  suites in the repository instructions and owning local skills.
- Keep provider secondary-use consent explicit in research integration flows,
  avoid duplicate individual Consent projections during Communication
  ingestion, and align medication projection tests with the consent gate.
- Add MVP digital-twin discovery across one or more IPS sections using an
  inclusive clinical date range and resource-agnostic text. GW resolves an
  omitted end date to request time, derives private text/date/language search
  fields, deduplicates subjects and excludes those fields from materialization.
- Require bilateral inter-tenant Contract VCs to use authorized-signatory
  roles and two verified `contractAgreement` proofs; technical `RESPRSN`
  remains transport/controller authority rather than implicit legal authority.
- Make `Consent.source-reference` the public stable key for each Digital Twin
  portal/software/study permission. GW now owns the internal
  `Consent.identifier`, reuses one rule per semantic reference, keeps distinct
  studies separate and aggregates permit/deny decisions without requiring BFF
  consent-id persistence.
- Align the high-level Digital Twin lifecycle, SEDIA matrix, adapter guidance
  and repository-local governance skill: patient portals own only the FHIR
  secondary-use toggle and normal IPS Communication flow; GW owns registered
  `urn:uuid` projection, while direct Composition ingestion remains restricted
  adapter compatibility plumbing.
- Make the local Fabric smoke pass explicit Linux/amd64 CCAAS build arguments,
  so Docker's classic builder does not resolve the `tini` download with an
  empty `TARGETARCH` when BuildKit is unavailable.
- Clarify the reusable legacy-controller skill: `_activate` avoids a second DCR
  but still registers the representative role-signing key and the controller
  wallet's separate public DIDComm signing/encryption JWKS. PIN, seed and
  private keys remain under portal wallet custody.

## [1.23.5] - 2026-08-31

- Verify the host-issued initial access token for encrypted `Device/_dcr`
  requests and project only its verified claims into the worker job, matching
  the existing plaintext route without trusting controller authority supplied
  by the request body.
- Verify the nested JWS before accepting bootstrap communication keys, keep
  signing and encryption keys distinct, and require registered actor keys
  outside the explicit pre-DCR bootstrap sequence.
- Add a high-level secure profile-enrollment 101 and SDK-only snippet, plus the
  matching local-image release skill contract.

## [1.22.2] - 2026-08-26

- Clarify and test the controller bootstrap split: legacy
  `Organization/_activate` binds the submitted historical representative key
  without a second DCR, while modern service-controller and employee device
  exchange requires a separately signed trusted OIDC `id_token` for the
  account/email binding. A controller VP proves role authority and cannot be
  used as the `_exchange` email proof.

- Accept the provider-level digital-twin secondary-use decision as a FHIR
  `Consent.meta.claims` rule without the legacy ODRL attachment. Other consent
  flows retain their attachment evidence requirement.

- Keep Google Cloud client authentication on the direct
  `google-auth-library` dependency across transitive Storage and Firestore
  clients. This preserves GKE Workload Identity metadata handling when the
  security-pinned `gaxios` override is active.

- Replace implicit tenant lifecycle cascades with controller-authorized
  preflight counts, dedicated Employee cleanup and explicit individual cleanup. Tenant
  disable and purge now fail with `409` while descendants remain, preserve
  retained communications, and bind controller proof using the complete typed
  legal identifier without truncating punctuation. Generic descendant cleanup
  rejects employees so it cannot bypass encrypted employee handling, license
  release or lifecycle audit metadata.

- Preserve one digital-twin `Composition` per source IPS document/version with
  all indexed IPS section tokens in the same `Composition.section` claim.
  Section-first search now treats that claim as multi-valued instead of
  synthesizing one Composition per section.
- Make subject-level secondary-use withdrawal a reversible digital-twin
  disable. `Consent.purpose=HRESCH`,
  `Consent.action=organization/ResearchSubject.rs`, and
  `Consent.decision=deny` pauses future synchronization without deleting the
  already published anonymous twin, operational clinical data, stable private
  subject alias, or consent audit evidence. A later `permit` rebuilds the same
  twin from current operational records.
- Add index-provider offboarding through
  `individual/.../ResearchSubject/_purge`. It deletes only the private
  individual-to-twin correspondence; the detached anonymous twin remains
  intact, and later enrollment allocates a new UUID.
- Restrict direct digital-twin `Composition/_batch` to researcher working
  selections whose subject is a tenant-registered UUID URN. Canonical writes,
  operational DIDs, and invented UUIDs are rejected.
- Document the portal/index-provider consent as an idempotent rule selected by
  its stable `Consent.source-reference`, so future study-specific research consents
  cannot be mistaken for the portal toggle.

## [1.22.0] - 2026-08-26

- Add product-neutral, opt-in break-glass authorization to GW CORE SMART token
  issuance. Human emergency reads require the exact `health-care` route and a
  ledger-verified physician credential; animal emergency reads require the
  exact `animal-care` route and a ledger-verified veterinarian credential.
  Research, One Health research, cross-kind and write access remain fail-closed.
- Persist only coded and hashed exceptional-access evidence to Fabric, require
  controller-notification acknowledgement before token issuance and cap the
  resulting token lifetime at 15 minutes. Free-text justification remains
  outside the ledger and is delivered only to the controller notifier.

## [1.21.34] - 2026-08-25

- Rebuild an employee's blind `kid` indexes whenever DCR adds or replaces
  device keys. Encrypted requests now retain a fail-closed compatibility
  lookup for historical records whose protected DID document contains the
  registered sender keys but whose bootstrap indexes were left stale.

## [1.21.33] - 2026-08-25

- Make tenant key provisioning idempotent across process restarts so an
  activation or Order replay cannot overwrite the private key behind an
  already published DID. Startup now repairs stale tenant DID key projections
  from recoverable KMS material, preserves identity/controllers/services and
  re-signs the tenant self-description.

- Let canonical `Token/_exchange` use the already validated route tenant when
  Firebase proves the controller without a custom `tenant_id` claim. An
  optional token claim must still match the route and can never redirect the
  exchange to another tenant.
- Make accepted organization Order replay work with real encrypted repository
  documents. The exact Offer is now matched against claims obtained after KMS
  unprotect, allowing an already active registration to continue without a
  false `409 not in pending state` response.
- Preserve the automatically issued representative access credential across
  accepted organization Order retries. An active-Offer replay now returns the
  original `IndividualProduct.serialNumber` without rotating the code,
  consuming another seat or requiring another payment. New Order responses
  expose claims only at canonical `data[].resource.meta.claims`.
- Resume organization activation after a partial Fabric commit when a newly
  detached-signed VC preserves its canonical issuer, type/schema,
  `credentialSubject` and evidence. Reissued envelope metadata no longer
  causes a false organization conflict; changed signed identity still returns
  409.
- Build host-authored onboarding Offer URNs with the host's legal jurisdiction
  instead of the applicant country. Keep pending registration authoritative
  until mandatory ledger writes succeed, and retain the Offer index on the
  active tenant for deterministic Order replay.
- Return the persisted seat's effective `licenseId` and `maxDevices` in every
  successful `License/_issue` entry so SDKs and portals do not substitute a
  potentially different local installation allowance.
- Synchronize the controller and commercial Order security contract with the
  derived deployment profile: compat-mode DIDComm plain may project an optional public JWK, but
  tenant operations verify `iss + kid` with the key registered by DCR.
  Encrypted host `Order/_batch` remains host-routed while resolving sender
  keys from the issuer tenant, and its exact static route is not rejected by a
  historical host service catalog that predates the commercial capability.

## [1.21.25] - 2026-08-25

- Adopt the Fabric `0.3.0` local host vocabulary end to end: `host1`/`host2`,
  `peer0-host1`/`peer0-host2`, `Host1MSP`/`Host2MSP`, host-scoped crypto paths,
  generated environment keys, chaincode administration scripts, smokes and
  public evidence. Add a regression check that rejects the former numbered
  organization placeholders in the local Fabric contract. Allow an explicit
  `FABRIC_DEVNET_ROOT` so clean worktrees and independent clones use their own
  host-scoped MSP material without modifying another checkout.
- Remove root-level `TEST*` and `TODO*` clutter by moving maintained testing
  guides to `docs/` and internal backlog/handoff material to `docs-internal/`;
  update repository navigation and repair the affected documentation links.
- Move the public production-readiness guide to the repository root as
  `PRODUCTION-READINESS.md`, link it from the main README, and replace the
  versioned root portal/API snapshots with one `portal-api-gw.md` pointer to
  the maintained contract under `docs`.
- Add a presentation-grade, checksummed open-source production-readiness
  evidence bundle covering the offline dataspace CA, dataspace ICA host VC,
  governed Fabric admission contract, `Host1MSP`/`Host2MSP` topology and the
  GW PostgreSQL/IPFS/Fabric restart lifecycle. The human-only report separates
  VAT tenants from host MSPs, routes EU Organizations/employees to
  `identity-eu`, keeps individuals on `identity-global`, excludes animal scope
  and records dynamic host admission as a remaining live-production gate.
- Extend the local SMART/Fabric acceptance path with a medical-secretary
  employee: explicit consent permits the employee to read a person's IPS, and
  a second employee without consent receives no access token. Pair that live
  check with the employee onboarding/DCR integration contract so a provisional
  shared host can serve `entity` and `individual` routes without conflating
  their identity channels.
- Redact disposable Fabric CA passwords from presentation logs and fail the
  final public-evidence gate if a known devnet enrollment secret remains.
- Warm every local identity chaincode before starting the GW image so a fresh
  Fabric devnet cannot race lazy chaincode launch during host bootstrap.

- Keep one canonical tenant identity when one organization splits capabilities
  across operators. `TENANT_SERVICE_ROUTES_JSON` can now publish different DID
  `serviceEndpoint` bases per tenant and section (for example, `entity` on an
  institutional host and `individual`/`digitaltwin` on another runtime)
  without changing the VAT-backed `tenantId` or duplicating the DID document.
- Route shared well-known, JWKS, identity, messaging and DSP/DCP services with
  the optional `default` tenant route so a moved tenant cannot retain an
  internal or localhost origin in its public DID document.
- Add a reproducible open-source Docker acceptance profile combining GW CORE,
  Fabric `local-network`, PostgreSQL and IPFS. The gate forces confidential JWE
  blobs out of relational rows, checks both stores and verifies host and tenant
  recovery after restart with the same local KEK. Document the complementary
  trust-control-plane gate: offline dataspace Root/issuer publication and local
  dataspace ICA evidence verification/VC issuance, kept distinct from Fabric
  CA enrollment.
- Make PostgreSQL index projection match the memory/Firestore repository
  behavior by collapsing duplicate name/value attributes within one document
  while preserving the strictest `unique` flag. This unblocks individual/family
  registration in the PostgreSQL+IPFS acceptance profile.
- Require an available professional seat for every current `Employee/_batch`
  create. When none is free, GW returns a persisted commercial Offer before
  creating any employee; a future import workflow must use its own explicit
  operation instead of a private claim or environment-controlled bypass.
- Derive employee Offer jurisdiction and sector from the authoritative tenant
  URN. License persistence uses the job sector, and the legacy activation
  exchange requires a sector in its verified token; no runtime path silently
  substitutes `us` or `health-care`. The host jurisdiction fallback is defined
  once in server configuration as `es`.
- Require portal-managed zero-price orders to include payment method and
  invoice/payment evidence. Test Network may verify that evidence through the
  configured mock provider, but it no longer materializes seats by silently
  bypassing the payment contract.
- Persist employee-seat Offers with the shared Offer/Order searchable index so
  the following `Order/_batch` resolves the exact Offer instead of returning a
  nested 404.

- Make organization activation retries safe across partially committed Fabric
  transactions. GW now ensures compatible organization/key assets, groups
  aliased DID verification methods by JWK thumbprint, and writes one key and
  one subject binding per unique public key while retaining every DID method id
  as binding metadata. The bundled local-network chaincode copies expose the
  same `EnsureOrganization` and `EnsureKey` contract as the deployed CCAAS
  services, so the documented Docker smoke exercises the production semantics.
- Inspect Fabric Gateway endorsement details instead of treating every generic
  `ABORTED` response alike. Stable organization/key incompatibilities map to a
  nested activation conflict (`409`); transient endorsement failures remain
  server errors and can be retried.
- Document `fabric-multicloud` as the canonical shared-chaincode owner and add
  an executable parity gate so the GW local-network packaging mirror cannot
  drift from the CCAAS contracts used in Kubernetes.

- Enable `onehealth-research` by default for every GW sector-resolution path,
  including explicit `ALLOWED_SECTORS` catalogs. Removing it now requires the
  explicit `DISABLED_DEFAULT_SECTORS=onehealth-research` opt-out plus a
  non-empty reason. GKE and Cloud Run release paths propagate the canonical
  sector variables.

- Consolidate the portal-to-GW mapping in
  `docs/PORTAL_API_TO_GW_CORE.md`: document the published DID binding,
  organization/individual license search and non-production `License/_add`
  contracts, with one root navigation pointer instead of a competing versioned
  source of truth.

## [1.21.22] - 2026-08-20

- Repair an exact two-seat initial professional inventory by converting its
  free second seat into the contact-free technical-controller reservation.
  Inventory therefore reports both initial licences as assigned before the
  later binding/DCR, without replacing a historical professional seat.

## [1.21.21] - 2026-08-20

- Resolve historical employee records through the authoritative tenant
  registry/cache mapping during startup reconciliation, with deterministic and
  logical collection names as read-only fallbacks. This restores missing
  public controller references when the physical collection name predates the
  current normalized naming scheme.

## [1.21.20] - 2026-08-20

- Reserve the first two seats of newly registered professional organizations
  for the verified representative and a contact-free technical-controller
  binding, while preserving historical professional assignments exactly.
- Never convert a historical professional seat or create an implicit third
  controller seat. A later controller must wait for a newly added or purchased
  licence when no seat is free.
- Repair missing representative reservations at startup from protected tenant
  claims and restore only controller DID references backed by active protected
  employee records.
- Add controller-authorized zero-cost professional `License/_add` for
  non-production `test` (in-memory), `local-network`, and `test-network`;
  `prod` or `network` keeps the signed payment and ledger-verifiable Order path.

## [1.21.19] - 2026-08-20

- Read and persist employee records in the tenant's resolved physical
  collection while keeping licences in the logical tenant vault.
- Keep employee creation and licence issuance as separate operations so
  create-plus-issue returns the activation credential reliably.
- Reconcile legacy representative re-registration to two employee seats
  without replacing technical controllers, synchronize outer and inner active
  licence status, and default new organization offers to two seats.
- Raise the default per-seat installation allowance from two to five
  independently revocable device/channel bindings.
## [1.21.18] - 2026-08-20

- Add deployment-wide `HOST_LEGACY_REPRESENTATIVE_CONTROLLER` compatibility
  for portals that historically register every organization through the legal
  representative. Propagate it into GKE after applying shared manifests and
  verify the release contract in tests and the repository skill.
- Add the safe public `/.well-known/tenant-status.json` projection for tenant
  lifecycle, controller DIDs, public key identifiers and DCR state.
- Resolve legacy lowercase `did:web` requests for VAT-based tenant paths
  against their canonical uppercase tenant identifiers, without changing
  opaque tenant paths or the returned DID document.
- Keep the legacy representative-controller skill, route documentation and
  examples deployment-neutral and free of product-specific identifiers.
- Build bootstrap controllers with the shared `buildProfessionalDidWeb(...)`
  and `normalizeSameAsHash(...)` contracts. Internal `urn:gdc:*` identifiers
  and portal-specific card/profile DIDs remain aliases; the tenant controller
  reference, employee record and public DID document use one operational DID.
- Resolve controller DID documents from their protected employee records,
  including multiple controllers and historical containers whose storage id
  differed from the embedded DID. Deduplicate the primary controller JWK when
  forwarding additional JWKS to ICA DID registration.
- Accept secure asynchronous polling requests with `thid` protected inside the
  form-encoded `request=<JWE>` envelope, matching the SDK submit-and-poll
  transport contract for every `*-response` endpoint.

- Let an authorized tenant controller complete a two-phase administrative
  shutdown: tenant disable cascades suspension to employees, individual
  organizations, and members; tenant purge then cascades cleanup of remaining
  descendant records, licenses, and blob references without requiring each
  individual controller to act.

- Make a verified legacy `Organization/_activate` re-registration of an
  existing tenant complete directly with `200`; it updates the historical
  representative controller without an Offer, Order, payment, license, or
  second tenant provisioning.

- Preserve the controller employee produced by legacy organization onboarding
  in the tenant DID from its first active version. Both `_activate` and the
  `_transaction` plus `Order/_batch` finalization now retain that controller;
  later `_issue` remains the independent `ServiceControllerCredential` path
  that appends, rather than replaces, the bootstrap controller.
- Allow an explicitly enabled legacy deployment to accept historical
  representative VCs that predate `RESPRSN` and embedded key material during
  `_activate`, while retaining normal VP, credential, and trust-registry
  verification without pinning a credential id, issuer, or portal signer `kid`.
- Make legacy `_activate` or `_transaction` re-registration idempotently upsert
  the representative controller on an existing tenant, append its DID without
  replacing service controllers, recreate a missing tenant collection, and
  avoid generating a new Offer or Order. A newly verified portal key replaces
  only that legacy controller's DID key material.

## [1.21.17] - 2026-08-18

- Fix the local research SMART smoke to discover medication Compositions with
  the preserved `MedicationStatement.code` token instead of the deliberately
  redacted `code-text` free-text claim, preventing false zero-result failures
  without weakening digital-twin de-identification.

## [1.21.16] - 2026-08-18

- Reject dotted FHIRPath-like pseudo-claims globally: short FHIR claim keys
  contain exactly the ResourceType separator dot and one lower kebab-case
  SearchParameter segment.
- Resolve Common Utils typings from the exact lockfile-installed package so
  local typecheck/build cannot silently use a stale sibling checkout.
- Omit malformed vocabulary claims before persistence with a structured warning:
  FHIR API search parameters require lower kebab-case, while Schema.org flat
  property paths retain camelCase and reject hyphens/underscores. Normalize the
  historical `CodeDisplay` and `CodeTextLocal` aliases to `code-display` and
  `code-text` when materializing `$summary`.
- Cover MedicationStatement's distinct official search claims: `code` is the
  medication-concept token, `medication` is a reference, and R5 `adherence` is
  an adherence-code token. Human-readable medication concept companions use
  canonical `code-text` and `code-display`.
- Log every 4xx/5xx bundle-entry `OperationOutcome` structurally in the worker
  before encrypting the response, including job/thread/resource/index context.

- Make `ALLOWED_SECTORS` the authoritative explicit gateway sector catalog,
  retain `SECTORS_ALLOWED` and `MAINSECTOR` + `SUBSECTORSALLOWED` only as
  deprecated fallbacks, and preserve independently addressed compatibility
  sectors such as `onehealth-research` without reconstructing their names.

## [1.21.15] - 2026-08-16

- Separate Test Network admission from postal-address verification. The host
  no longer requires or persists `postalActivationLicense` material from the
  review VC; Order remains responsible for issuing the controller activation
  credential later consumed by `Token/_exchange` and DCR.

## [1.21.14] - 2026-08-16

- Use the canonical HL7 v3 ActReason `HRESCH` for healthcare-research SMART,
  Consent, and inter-tenant contract authorization instead of the ad-hoc
  `RESEARCH` token.

- Remove the non-FHIR `Composition.branch` and `Composition.branch-version`
  claims from researcher working selections. Ownership and recovery now use
  standard `Composition.identifier`, `subject`, and `author` claims together
  with ledger-safe `meta.tag` coding metadata.
- Require Test Network onboarding to carry the reviewer-signed
  `OrganizationTestNetworkCredential` plus exactly three normal domain VCs
  marked `TestNetworkCredential`. Verify every ML-DSA-65 proof, PDF/identity
  binding and return only the Organization, LegalRepresentative and
  ServiceController credentials in `vc[]`.
- Use `resource.controller.email` for controller binding instead of confusing
  it with the distinct legal-representative compatibility payload.
- Consume Common Utils 2.5.7 and accept the Test Network admission VC only at
  `resource.organizationTestNetworkCredential`; remove the authorization-named
  transport and internal verifier terminology without an alias.
- Document the existing-tenant boundary faithfully: GW projects the ICA-issued
  ServiceControllerCredential into tenant/controller storage, while a portal
  BFF independently persists the three returned `vc[]` records.

## [1.21.13] - 2026-08-16

- Enforce employee-private digital-twin worksets from the authenticated SMART
  subject: tagged Composition searches are scoped to that hosted employee DID,
  and working-selection writes reject a different client-supplied author.

## [1.21.12] - 2026-08-15

- Project individual clinical ingestion into a minimal research-safe digital
  twin: retain a private stable subject alias, replace identifiers and
  subject references, remove patient and free text/display/narrative claims, and
  exclude identity-bearing Patient, RelatedPerson and Consent resources.
- Permit `DigitalTwinReader` for a verified employee of the provider tenant
  without an inter-tenant contract; foreign organizations still require the
  matching contract and consent policy. Research SMART scopes now expose the
  pseudonymous twin subject instead of the operational individual DID.
- Replace free-text twin search examples and E2E cases with coded FHIR claims.
- Publish `digitaltwin/Composition/_batch` for FHIR tenants so researchers can
  persist ledger-safe tagged working selections between coded discovery and
  `ResearchSubject/$summary`. Preserve that route for existing tenants whose
  stored service declaration exposed only Composition search, and prove the
  public batch-to-`Composition.meta-tag=system|code` lifecycle.

## [1.21.11] - 2026-08-14

- Preserve an explicitly selected local image in the GKE deployment profile so
  `SKIP_BUILD=true` publishes the exact image that passed the full Fabric smoke.
  Guard the overridable profile contract in the release-script tests.

## [1.21.10] - 2026-08-14

- Isolate direct-email consent coverage from organization-role coverage by
  using a different professional role for the email policy matrix. The allow
  case now proves the email rule itself, while the mismatched email is denied.

## [1.21.9] - 2026-08-14

- Align the research SMART image smoke with the canonical medication fixture:
  search the indexed `MedicationStatement.code-text` claim without requiring a
  non-existent `code-display` claim, and print the complete asynchronous
  response when the digital-twin release gate fails.

## [1.21.8] - 2026-08-14

- Bind the research SMART smoke contract to the live tenant DID discovered
  from the selected image instead of a fixture-only provider hostname.

## [1.21.7] - 2026-08-14

- Align the canonical individual image smoke with the transaction registration
  endpoint and namespaced accepted-offer claim, and fail immediately when the
  family order does not return `201` instead of continuing with a broken SMART
  setup. Seed the individual's consent rule and bind the client assertion
  audience to the actual SMART token endpoint before requesting access. Render
  consent projections through repository/package APIs instead of importing
  source files from a sibling workspace checkout. Canonical and compatibility
  role-system spellings now resolve to the same immutable consent rule ID.

## [1.21.6] - 2026-08-14

- Generate local Fabric profiles with an overridable peer endpoint so host
  processes use `localhost:7051` while Docker image smokes use the Fabric
  network DNS name `peer0-org1:7051`.

## [1.21.5] - 2026-08-14

- Let the canonical Fabric bootstrap prepare `local-network` without starting
  a host process so the Docker release smoke validates only the selected image.

## [1.21.4] - 2026-08-14

- Scope the canonical local and cloud Docker builds to the GW CORE repository,
  consume the published `gdc-common-utils-ts` dependency from the lockfile,
  exclude local secrets and generated directories, and pin release images to
  `linux/amd64` by default. Add image-level Fabric `local-network` smoke,
  reuse the tested image during publication, deploy the resolved registry
  digest, and block completion until rollout and public health checks pass.

## [1.21.3] - 2026-08-13

- Refresh Google Cloud runtime dependencies and enforce audited transitive
  versions; the production dependency tree now reports zero known
  vulnerabilities.
- Preserve legacy primary-device projection when the same stable installation
  receives a replacement DCR client, and match canonical medication
  `code-display`/`code-text-local` filters case-insensitively.
- Resolve organization, legal-representative and service-controller activation
  credentials through the shared canonical VC type sets, including the
  deprecated controller subtype only as explicit compatibility.

- Add controller-authorized `Device/_revoke` support for one selected employee
  installation. Revocation removes that device's DID verification methods,
  revokes its ledger bindings and profile, and preserves the employee seat and
  every other active installation.

## [1.21.2] - 2026-08-13

- Canonicalize legal-organization `_transaction` and `_issue` claims at
  `data[].resource.meta.claims` across portal input, GW output and ICA
  forwarding. Entry-level `meta.claims` remains a deprecated input fallback.

- Move legal-organization `_transaction` and `_issue` response claims from
  deprecated `data[].meta.claims` to canonical
  `data[].resource.meta.claims`; retain `resource.icaResponse` only as a raw
  transitional envelope and normalized credentials in sibling `vc[]`.
- Document and test canonical three-VC activation and the narrow legacy two-VC
  fallback requiring `RESPRSN` plus representative key binding.
- Validate tenant controller authority and key binding from the signed
  canonical `ServiceControllerCredential`, with `owner.additionalType = RESPRSN`
  and `owner.hasOccupation.occupationalCategory = ISCO-08|1330`, while keeping
  representative ISCO occupation independent; persist controller ISCO
  occupations as separately indexed employee attributes and preserve existing
  DID controllers.
- In portal-managed Stripe live mode, require paid Checkout/Invoice evidence
  to match the accepted offer, tenant, quantity, amount and currency before
  materializing licenses. Zero-price test-network offers remain explicitly
  payment-free and do not exercise Stripe.

- Accept `antifraud` as an independent FHIR-capable tenant sector for Company
  Book, Family Book and future non-health applications.
- Publish governance-controlled canonical definitions at the configured public standards base URL from
  the tenant `CapabilityStatement`, including active custom Communication
  search parameters and feature-gated future Contract parameters.
- Consume `gdc-common-utils-ts@^2.5.1` from npm, align Fabric Gateway/Noble with
  their ESM-compatible current releases, run Jest 30 consistently, and support
  Node.js 22 or newer without relying on sibling workspace links.
- Document and test the exact `Organization/_issue-response` boundary: all
  deduplicated ICA credentials are returned in `vc[]`, the raw ICA payload is
  preserved in `resource.icaResponse`, and the separate License activation code
  is carried in `resource.meta.claims` rather than a `License:Issued` VC/entry.
- Keep controller `sameAs` as the simple ICA-compatible contact-hash URN and
  persist the controller authorization role separately as the bare HL7 v3 code
  `RESPRSN`; remove the invalid `professional` suffix and ISCO-08 `1120`
  controller fallback.

- Accept an attached organization registration authorization VC only for Test
  Network `_transaction`, verifying trusted issuer, current human-controller
  DID relationship, active assertion method, ML-DSA-65 proof and exact
  application/controller/postal bindings; production remains ICA-backed.
- Resolve the human reviewer through the host signer registry by employee
  actor DID, normalized-email hash, `RESPRSN` role and active/revoked state.
  Permit a host HMAC attestation only for registry entries explicitly allowed
  to introduce the reviewer's unlocked-wallet ML-DSA-65 key; this bootstrap
  policy can move to Fabric without changing the VC contract.
- Persist the protected postal-code binding outside client claims and redeem
  the same physically delivered activation/licence code during Order; never
  issue a second secret for the registration.
- Model legal-organization control as an additive DID `controller` array. Each
  controller is stored and resolved as an independent encrypted Employee DID
  document; new writes no longer cache a singular `meta.controllerDidDocument`.
  Adding or rotating a controller must be signed by an active controller that
  is already present; only the first bootstrap may self-sign with the submitted
  actor key. A single actor public JWK is sufficient; DCR/device keys are not
  part of this controller operation.
- Derive Employee/controller JWK `kid` values from public material as RFC 9278
  SHA-256 thumbprint URNs and index `org.schema.Person.identifier`, `email`,
  `additionalType`, `hasOccupation.occupationalCategory` and repeated
  `hasCredential.material`.
  Legacy `email`, `role` and `kid` indexes remain during migration.

- Wire the existing FHIR R5 `SubscriptionManager` into the production worker
  registry so Subscription and SubscriptionTopic jobs no longer fail as an
  uninitialized manager.
- Add a pinned HAPI FHIR R5 Docker profile and executable REST-hook E2E that
  creates a topic, exact-patient subscription and Observation, then verifies
  the resulting `subscription-notification` Bundle.
- Publish the neutral Subscription and SubscriptionTopic `_batch` contracts in
  generated OpenAPI and expand their runtime JSDoc boundaries.

## [1.21.1] - 2026-08-09

- Bind a multi-device seat to
  `urn:multibase:<hash(normalized email or phone)>:professional|personal`, never
  to a portal DID or IdP-local `sub`. Fabric subject-key DCR/revocation records
  use that stable actor URN and retain each portal DID only as audit metadata.

## [1.21.0] - 2026-08-09

- Consume Common Utils 2.4.0 and reuse its SubscriptionTopic matcher and
  notification Bundle builder instead of duplicating neutral FHIR logic.
- Allow two simultaneous DCR installations per professional/member seat by
  default. A second installation no longer revokes the first device profile,
  DID keys, or Fabric key bindings; same-installation registration remains a
  rotation path and a third installation is rejected by allowance.
- Implement the neutral FHIR R5 SubscriptionTopic runtime: filter validation,
  handshake-gated activation, resource-event matching, encrypted notification
  outbox, HTTPS delivery and bounded retry state. Production rest-hook hosts
  require `FHIR_SUBSCRIPTION_ENDPOINT_HOSTS` allowlisting.

- Added encrypted FHIR R5 `Subscription/_batch` registration on tenant/BFF
  (`entity`) and exact-subject (`individual`) scopes, with device push fan-out
  kept outside the clinical subscription resource.
- Persist RFC 7591 DCR software and application metadata in device profiles.


## [1.20.30] - 2026-08-09

### Added

- Preserve a governed legal-organization controller DID and all submitted
  public JWKS during activation, reference that DID from the tenant DID, and
  resolve its separate multikey `did:web` document at the canonical employee
  DID path.

## [1.20.29] - 2026-08-05

### Fixed

- Consume Common Utils 2.3.28 so every generated/indexed clinical claim uses
  the stable `<ResourceType>.<concrete-param>` FHIR API vocabulary without
  camelCase or version-specific claim namespaces.

## [1.20.28] - 2026-08-05

### Fixed

- Collapse historical versions sharing one business identifier in `$summary`
  and rehydrate canonical
  claims into native FHIR fields such as Immunization occurrence/lot data.

## [1.20.27] - 2026-08-04

### Security

- Treat malformed and boundary-ended Consent periods as inactive, reject new
  SMART issuance after expiry, and cap every issued token `exp` at the earliest
  applicable `Consent.period-end`.

### Fixed

- Allow an authenticated product BFF to recover every individual Organization
  indexed to an exact owner email/telephone without supplying a browser-known
  nickname. Return a deduplicated searchset so card directories work across
  browsers while wallet/device keys remain device-scoped.
- Start the Consent CCAAS binary directly instead of through npm so the
  non-root runtime does not depend on a writable npm home during release smoke.

## [1.20.26] - 2026-08-03

### Fixed

- Match persisted canonical ISCO consent roles such as
  `org.ilo.isco-08|2211` with the equivalent compact role carried by a
  verified professional DID or VP (`ISCO-08|2211`). Role comparison remains
  exact after normalization; unrelated occupation codes are still denied.

## [1.20.25] - 2026-08-03

### Documentation

- Add a visual GW CORE contract map to `/api-docs` and the canonical reading
  order, separating actor-facade and `Communication/_batch` public boundaries
  from internal `$summary` resolution and direct compatibility routes.
- Extend that runtime map with DCR/SMART identity bootstrap and a numbered,
  responsive submit/202/poll/exact-readback lifecycle so the Swagger catalogue
  explains how GW behaves rather than presenting only a flat route list.
- Correct the portal/BFF endpoint matrix, manager JSDoc and OpenAPI descriptions
  so subject-index mutations and summary reads travel through Communication,
  while administrative Organization/License reads remain distinct.

## [1.20.24] - 2026-08-02

### Fixed

- Match SMART Consent roles for provider-neutral organization and individual
  member DIDs. The parser now reads the terminal identifier/role tuple instead
  of requiring the literal `employee` or `family` path segment.
- Treat hosted and external member DIDs with the same terminal identifier and
  coded role as aliases only after the verified VP binds the exact requesting
  actor; an unverified suffix alone never creates authorization.

- Reconcile a persisted host DID identifier against `HOST_EXTERNAL_DOMAIN` so
  an earlier Kubernetes-internal `*.svc.cluster.local` bootstrap cannot remain
  published through the public host-scoped `did.json` endpoint. The migration
  rebuilds verification-method identifiers and reissues the host legal
  participant/self-description VCs with the existing host keys and claims.
- Stop publishing the private KMS labels `comm_sig` and `vc_sign` as JWK
  members. DID documents now place the communication ML-DSA key under
  `authentication`, both ML-DSA/ES384 credential keys under `assertionMethod`,
  and ML-KEM under `keyAgreement`.
- Route host `Organization/_transaction` verification to the ICA path section
  selected by `NETWORK_MODE` (`local-network`, `test-network`, or `network`),
  while preserving `terms` as the compatibility alias for `test`.

## [1.20.23] - 2026-07-30

### Fixed

- Removed the unused host ICA enrollment placeholder that sent `DEMO-CSR` and
  `Bearer demo`; GW Core no longer pretends that a tenant/host Fabric
  certificate was enrolled successfully.

### Documentation

- Bound host peer enrollment to a signed `HostingServiceCredential`, a
  Root-controller governance decision and the privileged
  `fabric-multicloud` reconciler.
- Documented that MSP/TLS keys and CSRs are generated locally by the host and
  separated Fabric certificates from tenant X.509 leaves and the dataspace ICA
  `CA:FALSE` VC-signing identity.

## [1.20.22] - 2026-07-30

### Fixed

- Read the section of a native FHIR section-only batch from
  `Communication.topic` instead of `payload.contentCodeableConcept`, while
  retaining the old outer `Composition.section` claim only as a compatibility
  read.
- Narrow read-only Composition SMART requests to the exact active Consent
  intersection before signing the access token.
- Use the Stripe API version required by the locked Stripe 20.2 SDK in every
  payment and webhook client so a clean build remains type-correct.
- Make generated OpenAPI profiles reproducible by removing their wall-clock
  generation timestamp, so a clean release build leaves no tracked diff.
- Resolve Common Utils tests through the declared npm dependency instead of a
  hard-coded sibling checkout, allowing clean clones and CI worktrees to run.
- Preserve unambiguous legacy single-section IPS records that predate the
  per-resource `Composition.section` membership claim.
- Make the host transaction integration story declare its simulated ICA URL
  instead of depending on an untracked developer environment file.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.15`.

## [1.20.21] - 2026-07-30

### Fixed

- Reconstruct IPS Composition sections from each indexed resource's
  `Composition.section` claim instead of copying every shared
  Observation/Condition collection into every compatible section.
- Persist and return the IPS alert (`Flag`) and medical-device
  (`DeviceUseStatement`) sections during Communication import and
  `Subject/$summary` readback.
- Align the Stripe API version literal with the installed Stripe 20 SDK so the
  gateway test/build gate remains type-correct.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.13`.

### Changed

- Mark the gateway as a private npm project, add a failing `prepublishOnly`
  guard, and document that releases are immutable container images deployed by
  digest, never npm packages.

## [1.20.20] - 2026-07-30

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.12` so deployed gateways consume the
  complete IPS all-section claims, localized coded-name and fixture contract.

## [1.20.19] - 2026-07-29

### Fixed

- Preserve canonical `<ResourceType>.code-text`, `code-display` and `language`
  claims when projecting native FHIR resources; compatibility aliases can no
  longer replace manual text with `system|code`.
- Rehydrate canonical `code-display` claims into `Coding.display`.

### Changed

- Consume the official all-sections IPS fixture from
  `gdc-common-utils-ts/fixtures` instead of maintaining a gateway copy.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.9`.

## [1.20.18] - 2026-07-28

### Fixed

- Accept the independently addressable historical `onehealth-research`
  compatibility sector alongside the canonical health sector matrix.
- Bind a newly consumed employee license to the employee email and canonical
  role as well as its subject id, so the subsequent `License/_issue`,
  `Token/_exchange` and DCR flow can reuse the seat and register the employee
  device keys on `identity-eu`.

### Changed

- Split identity ledger routing: natural-person individuals remain on
  `identity-global`, while EU organizations, employees/controllers, locations,
  keys, identity evidence and identity events use `identity-eu`.

### Documentation

- Document the canonical professional identity boundary across employee/profile
  records, Consent, VP and SMART, including one shared SHA3-256 multibase
  payload for actor DID paths and credential `sameAs`, clinical-only scopes and
  provider endpoint audience resolution.
- Separate a controller's signed governance approval from the privileged,
  auditable infrastructure reconciler that updates channel membership, joins
  selected peers and activates committed chaincodes.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.8`.

## [1.20.17] - 2026-07-27

### Changed
- Accept `insurance` in the synthetic sector taxonomy and configure the GDC
  staging profile for the eight combinations of `animal|health` with
  `care|tech|research|insurance`.
- Resolve Fabric enablement from the provider selected for the active
  `NETWORK_MODE`; a `test=mem` runtime no longer acquires Fabric writes from
  mappings for `test-network` or `network`.
- Use process-owned `HLF_CONNECTION_PEER`, `HLF_CONNECTION_PEM`,
  `HLF_CERTIFICATE`, and `HLF_PRIVATE_KEY` as the canonical Fabric connection
  contract, retaining the MSP-suffixed names as compatibility fallbacks.

### Tests
- Cover active-network ledger selection and canonical/legacy Fabric connection
  environment names.

## [1.20.16] - 2026-07-24

### Fixed
- Process canonical Communication operation references and attachments directly
  from `resource.meta.claims`; manager execution no longer manufactures a
  native FHIR `payload[]` before running `Subject/$summary`, subject search or
  attached clinical projection.
- Keep native FHIR Communication payloads as a compatible input projection
  without making API claims-first jobs depend on R4 field materialization.
- Normalize native EHR FHIR resources through the shared
  `normalizeClaimsFromFhirResource(...)` boundary before indexed persistence;
  existing `resource.meta.claims` remain authoritative when present.

### Tests
- Replace the section-summary integration request assembled as native FHIR with
  the claims-first API shape emitted by the public SDK, and assert at unit level
  that attached Parameters execute while `resource.payload` remains absent.
- Retain native FHIR Communication unit coverage alongside the claims-first
  flow so neither interoperability direction can silently replace the other.

## [1.20.15] - 2026-07-24

### Fixed
- Hydrate claims-first `org.hl7.fhir.api` Communication shells before
  processing them, restoring the SDK-rendered operation reference and attached
  FHIR Parameters for `Subject/$summary` and the attached batch/collection for
  `updateClinicalSection(...)`.
- Preserve the native Composition section graph in API summary responses so
  `BundleReader` and `FhirDocumentFacade` resolve section resources and their
  claims without a second index query.
- Make the single-tenant demo bootstrap replace both accepted-offer claim
  aliases, preventing a false success with an uncreated tenant.

### Tests
- Cover the published-SDK flow `updateClinicalSection(r4)` ->
  `requestClinicalSummary(api)` for a section-only AllergyIntolerance update.

## [1.20.14] - 2026-07-24

- Raise `gdc-common-utils-ts` to `^2.3.6` for the staging image.
- Accept both OpenID DCR `application_type=web` and `native`, aligning the GW
  template with browser and native protected-profile enrollment.

- Communication clinical projection now processes section-scoped
  `Bundle.type=batch|collection` attachments when the outer Communication
  carries one `Composition.section`, and no longer invents the medication
  section when neither a document nor an explicit section was supplied.
  Unscoped clinical batches now return an explicit processing error instead
  of a successful ingestion followed by empty clinical readback.
### Added
- Accept the canonical FHIR `Parameters` attachment on Communications that
  request `Subject/$summary`, including subject, document-type and repeated
  section filters; query-string summary parameters remain compatible.

### Documentation
- Distinguish total Bundle entries, top-level UI-visible resources and
  section/type/date-filtered resources in the clinical summary lifecycle.
- Teach the immutable `FhirDocumentFacade` section/type/clinical-date-range
  chain in the GW lifecycle 101 instead of exposing raw Bundle-query filter
  fields or separate FHIR date/Period setters.
- Complete the GW 101 lifecycle with the canonical Communication
  `Subject/$summary` read path and concrete section, count, entry and
  section/type/date resource-consumption examples.
- Document the read-only `$summary` lifecycle and the ownership split between
  BundleReader, FhirDocumentFacade, SDK actor facades and domain format extensions.
- Expand the cross-portal subject-binding environment contract with
  deny-by-default behavior, reciprocal receiving-GW configuration and explicit
  issuer DID boundaries.
- Clarify that `HOST_PUBLIC_URL` must resolve to an externally routable
  Ingress, Cloud Run service or `LoadBalancer`, never a Kubernetes `ClusterIP`
  or GKE control-plane endpoint.

## [1.20.13] - 2026-07-23

### Added
- Accept a verified subject identity binding VC for individual self-read when
  the authenticated actor DID and requested individual DID are different.
- Require the binding issuer to be configured in
  `SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS` and the binding sector to match the
  routed sector.

### Security
- Keep physical support/card DIDs outside SMART authorization and continue to
  require the enclosing VP proof plus subject-scoped FHIR Consent evaluation.

## [1.20.12] - 2026-07-23

### Fixed
- Preserve an explicit public `organization.did` across the canonical legal
  organization `_transaction` and `Order/_batch` flow so the final tenant DID
  Document does not fall back to the operator IP or a hostname-only DID.
- Preserve `did:` and `urn:` values in DID binding `alsoKnownAs` updates while
  continuing to normalize domain and HTTP aliases to HTTPS.

### Documentation
- Document stable operator DNS configuration such as
  `HOST_EXTERNAL_DOMAIN=gw.example.org` and the current
  SDK/portal responsibility for supplying the public organization DID.

## [1.20.11] - 2026-07-23

### Fixed
- Keep the SMART inter-tenant `Contract` VC gate on
  `organization/ResearchSubject.*` digital-twin access. Individual
  `organization/Composition.*` self-read continues through its VP and
  subject-scoped FHIR `Consent` rules without being misclassified as a
  research consumer when its public DID root differs from the operator DID.

## [1.20.10] - 2026-07-22

### Fixed
- Keep the sector first in research channel families:
  `health-research-<jurisdiction>` and
  `animal-research-<jurisdiction>`.

## [1.20.9] - 2026-07-22

### Documentation
- Correct Fabric authorization so channel grants belong to an ICA-accredited
  organization accepted by host governance, while professional role/licence
  is a second internal action boundary. Define multi-species veterinary,
  emergency, One Health research, IT, government, insurance and global travel
  channel families with a minimal staging subset instead of requiring every
  target channel for the MVP.
- Define `subjectkeybinding-sc` as a derived many-to-many relationship index:
  `cryptographickey-sc` owns public-key material and lifecycle, while bindings
  own subject/device/role relationships and their independent lifecycle.
- Document that bindings store only `keyId`, cannot override key status and are
  not identity, proof of possession, licensing, consent or authorization.
- Track the authored `subjectkeybinding-sc` runtime sources that were
  accidentally hidden by the repository-wide `lib` ignore rule, so a clean
  checkout contains the contract imported by its entrypoint.

### Tests
- Prove that subject-key binding projection discards JWK, thumbprint,
  algorithm, use and key-status fields instead of duplicating canonical
  `cryptographickey-sc` state.
- Add a package-local ESLint 9 flat configuration so the declared lint gate is
  executable in a clean checkout.

## [1.20.8] - 2026-07-22

### Added
- Add typed region-final Fabric channel construction for the six approved
  regions and make `identity-global` the non-regional human identity default.
- Add the normative human-health versus animal-health network/channel and
  resource-chaincode matrix, with the future travel credential explicitly
  marked as a target contract.

### Documentation
- Define the identity-ledger bootstrap order: governance-executor organization
  first, then its Root CA controller employee/person and canonical
  `hasCredential.material` commitment.
- Document the implemented GW role of `subjectkeybinding-sc`: write-only
  derived audit/lifecycle state today, with reverse lookup and authorization
  enforcement explicitly not implemented.
- Add the chaincode README with transactions, identity/sector channel
  boundaries, credential-plane separation and current limitations.
- Separate the human-health funding boundary from the commercial animal-health
  reuse boundary, including independent staging Fabric networks.

## [1.20.7] - 2026-07-22

### Documentation
- Keep the host PDF free of Fabric channels, permissions, block-zero hashes and
  chaincode policy. Root governance configures channel read/write membership
  separately and Fabric provisioning injects technical fingerprints.
- Correct the Root CA controller trust chain: the employee/person
  `hasCredential.material` RFC 9278 URN is the canonical subject-to-key binding;
  auxiliary subject-key/key registries are derived lifecycle indexes. Document
  the missing one-time Fabric bootstrap transaction and keep Fabric-CA X.509
  credentials separate from the controller's public post-quantum JWK.

### Fixed
- Let new `staging/test-network/scoped-v2` MVP deployments start without
  genesis hashes or a per-host chaincode allowlist. `prod` or `network` still
  require live block-zero verification.
- Make scoped-v2 startup verify all live Fabric genesis fingerprints before
  infrastructure bootstrap, validate every persisted binding before one
  combined binding write, and initialize host KMS keys only after ledger
  protection succeeds.
- When genesis verification is enabled, enforce its bound host channel ceiling
  without introducing a per-host chaincode allowlist. MVP chaincode operations
  remain governed by GW licensing/actor policy and Fabric policy.

## [1.20.4] - 2026-07-21

### Added
- Add the explicit `legacy-v1` and `scoped-v2` persistence layouts. Existing
  deployments keep their physical collection and section paths unchanged;
  new scoped deployments use the typed
  `<deployment>_<network-mode>_<host>` prefix.
- Verify and persist the SHA-256 fingerprint of Fabric block zero for every
  configured channel before enabling a scoped GW. Startup fails closed when
  the peer, configured fingerprint or stored binding disagree.

### Changed
- Add finite Fabric block-event deadlines so genesis verification cannot leave
  startup waiting indefinitely.
- Remove stale ESLint and Prettier scripts, which referenced unconfigured and
  undeclared tools. TypeScript checking and tests remain the executable source
  gates.

## [1.20.3] - 2026-07-21

### Fixed
- Store the Gaia-X ServiceOffering terms evidence as the SHA-256 hexadecimal
  digest of the uploaded document bytes. LegalPerson no longer depends on
  terms or synthesizes a hash from a URL.
- Keep a public encryption-kid owner index so bounded key-cache eviction does
  not prevent legacy polling from decrypting host- or tenant-addressed JWE
  responses.
- Align family lifecycle and gateway crypto tests with route jurisdiction,
  operational-tenant checks and the current per-recipient CEK-wrap profile.
- Consume `gdc-common-utils-ts` 2.3.3 for ISO 3166-1 Gaia-X addresses and
  strict ServiceOffering terms evidence.

## [1.20.2] - 2026-07-21

### Changed
- Replaced the legacy Gaia-X `v2206` LegalParticipant projection with the
  shared ICAM 25.11 LegalPerson contract. LegalPerson is the participating
  legal organization; the natural LegalRepresentative remains a separate VC.
- Service-offering well-known artifacts are now independently signed Gaia-X
  ServiceOffering Enveloped VCs using VC-JWT and reference the provider's
  LegalPerson credential and service terms.
- Compact-JWS signing accepts protected `typ`/`cty` headers while retaining
  KMS-owned `alg` and `kid` values.

### Security
- Production now rejects in-memory and raw `KEK_SECRET` envelope custody,
  validates a rotatable Cloud KMS CryptoKey and unwraps one encrypted service
  runtime KEK per pod/process during `buildInfrastructure()`.
- Tenant key records now use the runtime KEK locally with AES-GCM context AAD;
  provisioning, rehydration and business operations no longer call Cloud KMS.
- Added runtime-KEK provisioning and executable one-KMS-decrypt bootstrap tests.
- Added the KMS/ML-KEM responsibility and audit-evidence matrix. ImagingStudy,
  profile PIN custody and product marketplaces remain outside GW Core.

## [1.20.1] - 2026-07-17

### Changed
- Removed the duplicate `PlanOfTreatment` digital-twin projection entry; the
  canonical `PlanOfCare` LOINC section maps once to the care-plan collection.
- Updated the shared dependency to `gdc-common-utils-ts@^2.3.1`, including the
  canonical colon-delimited hosted-provider DID correction.

### Fixed
- Individual Offer generation now reads the jurisdiction/network from the
  preserved `cds-<jurisdiction>` route context instead of treating the
  individual's optional `Organization.addressCountry` as that network.
- Offer generation still fails before persistence when `hostDid`, route
  jurisdiction, or sector is missing, preventing identifiers such as
  `urn:cds:undefined:v1:...` from entering the Order lifecycle.
- Preserved Family Offer claims when an accepted Order moves the registration
  from pending to active, so subsequent Offer/Order searches remain auditable.
- Made contextual claim lookup work in both `contextualized` and `canonical`
  identity storage modes; fully-qualified Order constants no longer disappear
  when `CLAIMS_IDENTITY_STORAGE_MODE=canonical`.
- Prevented claims-first FHIR resources with the same sparse resource shell
  from collapsing into one projection by deriving their version/deduplication
  CID from the complete clinical claims.

### Testing
- Replaced shallow mutable lifecycle fixtures with isolated clones and added
  assertions for Offer creation, Order confirmation, tenant activation, async
  polling, PDF persistence, bearer verification, and multi-contact lookup.
- Added integration coverage proving that three distinct Consent permissions
  survive Communication ingestion and remain independently readable.

## [1.20.0] - 2026-07-14

### Changed
- Made Jest environment-file resolution use the process working directory so
  unit, integration and E2E runners consistently load their selected local
  environment file.
- Clarified confidential-storage persistence documentation so it describes
  generic operational data rather than a channel-specific payload type.
- Expanded contributor guidance for the required TDD and executable-101 test
  structure.

### Testing
- Replaced the obsolete Firestore vault repository E2E specification with the
  current vault blood-pressure daily-batch integration coverage.

### Changed
- Added explicit `docs-v2` terminology so GW docs no longer mix:
  - `ProfileRuntime` as the unlocked end-user profile runtime
  - `TenantServiceRuntime` as the technical service/tenant wallet/runtime
  - `ChannelBackendPort` as the product/channel API above those runtimes
  in:
  - `docs-v2/101-README.md`
  - `docs-v2/09-api-integrators-guide.md`
  - `docs-v2/19-key-custody-and-audit-readiness.md`
- Added one centralized integration map so
  front/BFF/backend contributors now have one high-level entry point for:
  - inter-tenant research access choreography
  - `digitaltwin` SMART scope and `Composition/_search` semantics
  - DCR vs human-profile identity boundaries
  - current-vs-deferred status for researcher overlays, `urn:twin`, and
    reusable wallet/profile modules
- Replaced the repository-local SMART `client_assertion` test fixture with the
  published shared helper from `gdc-common-utils-ts` so GW manager/integration
  coverage now exercises the same JWT construction path consumed by the SDK
  layers:
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Extended `digitaltwin/.../Composition/_search` so one request can match
  directly against researcher working-selection `Composition` records stored in the
  digital-twin composition collection, instead of only fanning out through
  leaf resource families first. The first direct `Composition.*` capability
  now covered is `Composition.meta-tag`, matched as a tokenized
  `system|code` filter against stored `meta.tag[]` / `tag[]` values.
  TDD coverage now proves:
  - one unit-level digital twin working-selection `Composition` tagged with
    `urn:research:tag:score|10` is returned by
    `Composition/_search(section + Composition.meta-tag)`
  - one integration-level `digitaltwin` search returns a selection composition
    persisted in the tenant vault with the same `meta.tag[]` payload
  Files:
  - `src/managers/TwinCompositionManager.ts`
  - `src/__tests__/unit/managers/CompositionManager.test.ts`
  - `src/__tests__/integration/composition.bundle-search.api.test.ts`
- Extended the local Fabric/local-network audit chain so the canonical demo
  now exercises live consent-to-SMART-token flows for both:
  - clinical `individual` access rooted at `organization/Composition.rs`
  - research `digitaltwin` access rooted at `organization/ResearchSubject.rs`
  The new smoke proves:
  - one individual-professional SMART token can read the IPS bundle through
    `individual/.../Bundle/_search`
  - one research permit anchored from consent rules can issue a SMART token
    that reads `digitaltwin/.../Composition/_search`
  - research employees are allowed or denied both by matching role and by
    direct-email targeting
  - `scripts/project-audit-demo.sh` now chains the SMART access smoke together
    with the existing consent-asset and consent-lifecycle live checks
  Files:
  - `scripts/smoke-smart-access-local-network.sh`
  - `scripts/project-audit-demo.sh`
  - `scripts/payload-helpers.sh`
  - `scripts/render-demo-smart-access-payload.mts`
  - `src/__tests__/data/demo-smart-access-local-network.data.ts`
  - `src/__tests__/unit/data/demo-smart-access-local-network.data.test.ts`
  - `src/__tests__/integration/helpers/research-access-sdk.ts`
  - `src/__tests__/integration/identity/research-access.conversation.test.ts`
- Aligned the architecture and closeout/docs-v2 narrative with the now-proven
  SMART split and local-network audit chain:
  - clarified that Node/Jest TDD and live shell/Fabric smokes are complementary
    layers, not replacements for each other
  - documented that `digitaltwin/.../Composition/_search` is gated by
    `organization/ResearchSubject.rs...`, while `individual` remains gated by
    `organization/Composition.rs...`
  - recorded the current executable proof status for employee allow/deny by
    role and by direct email
  Files:
  - `ARCHITECTURE.md`
  - `docs-v2/23-digital-twin-composition-search-contract.md`
  - `docs-end/03-identity-ledger-contract-plan.md`
  - `docs-end/05-project-closure-use-cases-and-lifecycles-summary.md`
- Repackaged the closeout document set under `docs-end/` and added index files
  for both closeout and `docs-v2` so the repository now exposes one explicit
  reading order instead of the previous `docs-internal/` ad-hoc set.
  Files:
  - `docs-end/README.md`
  - `docs-end/01-newbie-audit-runbook.md`
  - `docs-end/02-current-state-traceability.md`
  - `docs-end/03-identity-ledger-contract-plan.md`
  - `docs-end/04-trust-bundle-operator-roles.md`
  - `docs-end/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-end/06-project-closure-executive-summary.md`
  - `docs-v2/README.md`
  - removed `docs-internal/*`
- Refreshed the chaincode/deep-dive/docs-v2 references so public docs no longer
  depend on workstation-local absolute paths and now point to stable GitHub or
  workspace-relative references.
  Files:
  - `chaincode/docs/101-CONSENTACCESS-SC-CCAAS.md`
  - `docs-v2/21-research-digital-twin-technical-backlog.md`
  - `docs/04-DEEP-DIVES/04.K-FABRIC-ADAPTER-INVENTORY-AND-DUAL-NETWORK-TARGET.md`
  - `docs/04-DEEP-DIVES/04.L-TEST-LOCAL-TOPOLOGY-AND-FABRIC-ENV-LOADER.md`
  - `docs/04-DEEP-DIVES/04.M-CONSENTACCESS-NETWORK-DEPLOY.md`
- Expanded gateway-facing example payload fixtures to show the canonical SMART
  proof layering and to mirror claims into `resource.meta.claims` where shared
  readers now expect canonical bundle payloads.
  Files:
  - `src/__tests__/data/example-payloads.ts`
- Added host onboarding route coverage proving that host `Order/_batch` must
  use the host registry network selector in the URL path rather than the tenant
  business sector, returning `404` when the wrong path shape is used.
  Files:
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts`
- Updated the portal/BFF/GW mapping reference and regenerated OpenAPI profile
  timestamps so the route table, examples, and generated profile metadata stay
  synchronized with the current branch content.
  Files:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-extension.json`
  - `CONTRIBUTING.md`

## [1.19.2] - 2026-06-30

### Changed
- Completed the current SMART token hardening pass for both clinical
  `Composition` access and research `ResearchSubject` access:
  - canonical behavior still accepts `body.vp_token` plus Clearing House
    verification
  - the gateway also accepts one signed `client_assertion` plus
    `client_assertion_type` on `identity/openid/smart/token`
  - compatibility labels accepted for `client_assertion_type` include the
    standard JWT-bearer URN, `private_key_jwt`, and `client_assertion`
  - inter-tenant `RESEARCH` flows may also use one already-validated external
    `Bearer data access token` instead of `body.vp_token` when:
    - `purpose=RESEARCH`
    - requester organization is foreign to the issuer tenant
    - external issuer is listed in `EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS`
    - provider tenant, consumer organization, purpose, and requested
      capability match
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/routes/api.ts`
  - `docs/90.A-API_INTEGRATORS_GUIDE.md`
  - `docs/openapi-examples/core-flow-examples.json`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-extension.json`
- Extended consent-rule evaluation for SMART token issuance so stored
  `Consent.action` values may be interpreted as either:
  - legacy section-only clinical actions such as
    `LOINC|48765-2,LOINC|10160-0`
  - canonical stored capability expressions such as
    `Composition.rs?section=...` and `ResearchSubject.rs`
  This preserves backward compatibility for current clinical rules while
  adding canonical rule matching for digital-twin research access.
  Files:
  - `src/managers/OpenIdAuthManager.ts`
- Tightened SMART root capability and endpoint compatibility enforcement so:
  - token issuance accepts only `organization/Composition...` and
    `organization/ResearchSubject...` root capabilities
  - `patient/Composition...` and `patient/ResearchSubject...` are rejected at
    token issuance time
  - `individual` endpoints require one `organization/Composition...` root scope
  - `digitaltwin` endpoints require one
    `organization/ResearchSubject...` root scope
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/routes/api.ts`
  - `src/utils/smart-scope-route-authorization.ts`

### Tests
- Expanded unit coverage for `OpenIdAuthManager` so the manager now proves:
  - canonical stored `Composition.rs?section=...` rules match one clinical
    `organization/Composition...` request
  - `patient/Composition...` and `patient/ResearchSubject...` root scopes are
    rejected
  - inter-tenant research access can be authorized from one trusted external
    bearer
  - canonical stored `ResearchSubject.rs` rules match one research
    `organization/ResearchSubject...` request
  - research employees can be included or excluded by:
    - matching role
    - mismatching role
    - direct email target
    - direct email target for another employee
  - professional SMART requests with `vp_token` plus `client_assertion`
    continue to issue tokens
  Files:
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
- Expanded integration coverage for `identity/openid/smart/token` so the route
  now proves:
  - clinical `Composition` token issuance still works
  - foreign-tenant research token issuance still works from one matching
    inter-tenant contract VC
  - research token issuance also works from one trusted external bearer
  - research token issuance also works when the stored action is canonical
    `ResearchSubject.rs`
  Files:
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Added dedicated scope-route authorization tests so the project now proves:
  - unit-level route compatibility for `individual` vs `digitaltwin`
  - integration-level route rejection when a `ResearchSubject` token is used on
    `individual`
  - integration-level route rejection when a `Composition` token is used on
    `digitaltwin`
  Files:
  - `src/__tests__/unit/utils/smart-scope-route-authorization.test.ts`
  - `src/__tests__/integration/identity/smart-scope-route-gates.test.ts`

## [1.19.1] - 2026-06-29

### Changed
- Tightened SMART inter-tenant authorization so a foreign organization actor
  can obtain a token from a tenant only when the presented `vp_token`
  contains one active inter-tenant access contract VC whose FHIR `Contract`
  subject matches:
  - provider organization DID = token-issuing tenant
  - consumer organization DID = requesting actor organization
  - requested capability scope(s)
  - requested purpose when the contract declares one
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Added one didactic inter-tenant research-access integration flow that
  packages the current GW behavior as the future high-level
  `OrganizationControllerSdk` + `DigitalTwinSdk` choreography:
  - provider tenant `acme-id`
  - consumer tenant `lab-id`
  - subject `Doraemon` with one IPS import
  - subject `Novita` with demo `ibuprofen` and `paracetamol` medication flows
  - SMART token issuance from contract VC proof
  - `digitaltwin/.../Composition/_search` returning one digital twin for
    `ibuprofen` and one for `paracetamol`
  Files:
  - `src/__tests__/integration/helpers/research-access-sdk.ts`
  - `src/__tests__/integration/identity/research-access.conversation.test.ts`
- Closed the internal closeout naming/documentation rule so research-access 101
  material consistently uses `OrganizationControllerSdk` + `DigitalTwinSdk`
  rather than `DigitalTwinControllerSdk`, and explicitly documents that GW
  retains smart-contract, queue, and storage plumbing:
  - `docs-internal/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-internal/06-project-closure-executive-summary.md`

## [1.19.0] - 2026-06-29

### Added
- Added a focused route-level regression for professional device replacement so
  `Device/_dcr` keeps the current seat-reuse and identity-ledger expectations
  executable through the public GW API:
  - `src/__tests__/integration/device.dcr-replacement.api.test.ts`
- Added a dedicated unit slice for the extracted individual/family onboarding
  flow helper:
  - `src/__tests__/unit/managers/hosting/process-individual-organization.test.ts`
- Added internal closeout summaries for the current project state and the
  consolidated use-case/lifecycle narrative:
  - `docs-internal/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-internal/06-project-closure-executive-summary.md`

### Changed
- Completed the current `HostingManager` modularization pass so the host
  onboarding/commercial lifecycle no longer depends on one monolithic manager
  file for verification, activation, DID registration, order processing, host
  config persistence, controller identity recovery, and service/resource
  extraction:
  - `src/managers/hosting/activation-helpers.ts`
  - `src/managers/hosting/controller-entity-config.ts`
  - `src/managers/hosting/create-pending-tenant-registration.ts`
  - `src/managers/hosting/ensure-authority-tenant.ts`
  - `src/managers/hosting/finalize-tenant-config.ts`
  - `src/managers/hosting/hosting-claim-contracts.ts`
  - `src/managers/hosting/ica-did-registration.ts`
  - `src/managers/hosting/ica-enrollment.ts`
  - `src/managers/hosting/ica-verification.ts`
  - `src/managers/hosting/organization-issue-controller-identity.ts`
  - `src/managers/hosting/persist-host-config.ts`
  - `src/managers/hosting/process-individual-organization.ts`
  - `src/managers/hosting/process-offer-order-search.ts`
  - `src/managers/hosting/process-order-entry.ts`
  - `src/managers/hosting/process-organization-activation.ts`
  - `src/managers/hosting/process-organization-verification.ts`
  - `src/managers/hosting/process-registration-entry.ts`
  - `src/managers/hosting/process-tenant-did-document-binding.ts`
  - `src/managers/hosting/reconcile-host-runtime-config.ts`
  - `src/managers/hosting/registration-keys.ts`
  - `src/managers/hosting/resource-extraction.ts`
  - `src/managers/hosting/service-attachment.ts`
  - `src/managers/HostingManager.ts`
- Hardened the host commercial onboarding contract so `_transaction`,
  `_activate`, `Offer/_search`, and `Order/_batch` coverage now fails fast when
  canonical commercial claims or required service-category/order-acceptance
  claims disappear:
  - `src/__tests__/integration/host.transaction-offer-order.api.test.ts`
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts`
  - `src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts`
  - `src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/unit/managers/HostingManager.ica.test.ts`
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts` now also
    proves that host `Order/_batch` rejects `health-care`-style tenant business
    sectors in the path with `404`; host onboarding must use the registry
    network selector (`test`, `test-network`, `network`) instead.
- Aligned the individual/family compatibility flows with the real commercial
  host bootstrap order so multi-phone and multi-email owner matching is tested
  only after the tenant has gone through registration plus `Order/_batch`, and
  all readback now uses shared bundle-claim readers instead of ad hoc
  `body.data[0]` drilling:
  - `src/__tests__/integration/individual/family.test.ts`
  - `src/__tests__/integration/individual/family.multiphone.test.ts`
  - `src/__tests__/integration/individual/family.multimail.test.ts`
  - `src/__tests__/unit/examples/shared-flow-examples.test.ts`
  - `src/managers/FamilyManager.ts`
- Tightened device-registration behavior and coverage so professional device
  replacement keeps the seat/license continuity and local ledger write path
  consistent with the current controller recovery lifecycle:
  - `src/managers/DeviceRegistrationManager.ts`
  - `src/__tests__/managers/DeviceRegistrationManager.test.ts`
- Linked the new shared SDK lifecycle note for controller/device recovery from
  GW CORE documentation entry points:
  - `README.md`
  - `docs/README.md`
- The canonical cross-repository reference for:
  - legal organization controller recovery via `_issue`
  - professional device replacement via `_exchange` + `Device/_dcr`
  - individual controller recovery
  now lives in `gdc-sdk-core-ts/docs/ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md`.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.17` so GW
  tests and manager flows consume the published bundle-claim readers instead of
  hand-parsing first-entry claim payloads.
- Refreshed the generated OpenAPI profile documents and swagger wiring so the
  published API examples stay aligned with the current host onboarding and
  lifecycle behavior:
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-extension.json`
  - `swagger.config.cjs`

### Validation
- `npm install`
- `gdc-common-utils-ts@2.0.17`, `gdc-sdk-core-ts@2.0.10`, `gdc-sdk-node-ts@2.0.11` published and consumed locally
- `npm run build`

## [1.18.0] - 2026-06-28

### Added
- Added employee device-replacement lifecycle handling to `Device/_dcr` so a
  reissued activation code can reuse the same professional license seat while:
  - revoking the previous local device profile bound to that seat
  - replacing the employee `didDocument` verification methods with the newly
    registered device keys
  - syncing employee device keys and subject-key bindings to the identity
    ledger when Fabric/local-network identity writes are enabled
- Added manager coverage for the employee device replacement flow, including
  local identity-ledger revocation/registration calls:
  - `src/__tests__/managers/DeviceRegistrationManager.test.ts`
- Added `docs-v2/24-local-audit-fabric-runtime.md` to define the current
  local ICA + GW CORE + Fabric baseline for auditors/integrators, including:
  - the supported deterministic local Fabric devnet path
  - the current local channel scope (`health-care-local` and `identity-local`,
    with research later)
  - the recommended responsibility split where GW CORE, not ICA, performs the
    current business/audit Fabric writes
  - the next implementation step for generic FHIR CID/version anchoring
- Added unit coverage for local-vs-regional identity ledger channel
  resolution in `src/__tests__/unit/utils/ledger.test.ts`.
- Added `npm run local:fabric:stack`, a Node orchestrator that can bootstrap
  the local Fabric devnet, prepare `.env.local-fabric`, deploy the local
  consent-access chaincode, start GW CORE in background, and bootstrap tenant
  `acme-id`.
- Added `npm run project:audit:demo`, a wrapper command that packages the
  current validated local closeout path in this repo:
  - local Fabric bootstrap
  - GW CORE startup
  - canonical demo individual creation
  - consent lifecycle smoke against `health-care-local`
- Added `docs-internal/` as the semi-internal project traceability layer,
  separate from `docs-v2`, including:
  - closeout TODO/status
  - newbie/auditor runbook
  - current-state traceability note
  - identity/artifact ledger contract plan for the next branch
- Added audited local deployment support for the identity-ledger contracts on
  `identity-local`, including:
  - `organization-sc`
  - `cryptographickey-sc`
  - `employee-sc`
  - `evidence-sc`
  - `credential-sc`
  - `artifact-sc`
  - `artifactevent-sc`
  - `subjectkeybinding-sc`
- Added initial GW CORE identity-ledger onboarding wiring for organization
  registration:
  - organization writes to `organization-sc`
  - public-key writes to `cryptographickey-sc`
  - subject-to-key writes to `subjectkeybinding-sc`
  - onboarding PDF/hash artifact writes to `artifact-sc` / `artifactevent-sc`
- Added unit coverage for the new `HostingManager` identity-ledger wiring,
  including the fallback path when a JWK thumbprint is unavailable.
- Added `consentaccess`-style modular `lib/` layouts plus exhaustive JS test
  coverage for the active identity/artifact ledger chaincodes:
  - `organization-sc-javascript`
  - `cryptographickey-sc-javascript`
  - `artifact-sc-javascript`
  - `artifactevent-sc-javascript`
  - `subjectkeybinding-sc-javascript`
  Each now ships with separated `constants`, `utils`, `exists`, `read`,
  `write`, `history`, asset builder, contract tests, and helper/lib tests at
  `100%` statements/branches/functions/lines.

### Changed
- Local Fabric defaults now use explicit local channel names for
  `NETWORK_MODE=local-network`:
  - consent-access and local healthcare writes default to `health-care-local`
  - identity ledger fallback now defaults to `identity-local`
  - `test-network` remains on the existing regional channel naming
- `ConsentManager` now resolves consent-access writes from the explicit local
  Fabric data-channel env when present, so `local-network` writes go to
  `health-care-local` instead of the regional jurisdiction fallback.
- `scripts/demo-create-individual-organization.sh` now defaults to the KYC /
  OTP-style onboarding path for local demo flows:
  - it no longer depends on a fake signed PDF
  - it generates the canonical reusable individual alias `Doraemon` by default
  - certificate-signed PDF onboarding remains available as an explicit opt-in
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.16` and
  aligned the research/digital-twin shared layer with the latest published
  common-utils package boundary:
  - `package.json`
  - `package-lock.json`
  - `src/shared/healthcare-constants.ts`
  - `src/shared/fhir-constants.ts`
  - `src/shared/data-collections.ts`
  The gateway still keeps a small local fallback layer for IPS summary
  sections and GW-specific response/index taxonomies that are not yet
  published upstream.
- `scripts/bootstrap-local-fabric-stack.mjs` now deploys the identity
  chaincodes before `consentaccess-sc` and `--restart-gw` now always closes any
  process listening on `:3000`, not just the tracked PID file.
- `scripts/prepare-consentaccess-local-fabric-env.sh` now enables the generic
  identity ledger path in `.env.local-fabric` and exports the explicit
  chaincode names used by `HostingManager`.
- The Fabric devnet deploy helpers now support staging chaincode sources from
  the sibling `gwtemplate-node-ts` repo into the devnet workspace, which makes
  the audited local multi-repo lifecycle reproducible from a clean clone.
- `organization-sc` now stores the canonical ICA-issued organization VC plus
  `meta.audit`, and no longer persists parallel `governanceVc`,
  `selfDescriptionVc`, `evidence`, `metadata`, or hosted-DID routing noise in
  the organization asset itself.
- `artifact-sc`, `artifactevent-sc`, and `subjectkeybinding-sc` now write
  free-form payload extensions under `meta.attributes` instead of a parallel
  top-level `metadata` bag, while keeping legacy-read compatibility for older
  stored assets.
- GW identity-ledger writes now derive the organization ledger id from the
  canonical legal-id claims as `identifier.additionalType|identifier.value`
  instead of using the opaque organization URN as the primary ledger key.
- `src/blockchain/fabric/v3/manageAsset*.ts` wrappers now carry JSDoc that
  clarifies their role as semantic aliases over generic Fabric `submit(...)`
  calls instead of hidden special execution paths.

## [1.17.0] - 2026-06-27

### Added
- Added the digital twin research search and materialization contract to the
  v2 docs set, including the technical backlog, environment variable
  reference, and the dedicated `Composition/_search` contract:
  - `docs-v2/21-research-digital-twin-technical-backlog.md`
  - `docs-v2/22-environment-variables-reference.md`
  - `docs-v2/23-digital-twin-composition-search-contract.md`
- Added the official HL7 IPS all-sections fixture plus TDD coverage for
  section-first twin search and `ResearchSubject/$summary` materialization:
  - `src/__tests__/data/fhir-ips-bundle-all-sections.json`
  - `src/__tests__/unit/managers/CompositionManager.test.ts`
  - `src/__tests__/integration/composition.bundle-search.api.test.ts`

### Changed
- Separated `individual` and `digitaltwin` orchestration more explicitly:
  `TwinCompositionManager` now owns digital twin `Composition` routing while
  `CompositionManager` remains focused on individual/compatibility summary and
  bundle retrieval paths.
- Completed the research twin sharing flow so
  `digitaltwin/.../Composition/_search` discovers matching twin indexes by IPS
  section plus textual resource claims, and selected twins can now be
  materialized through `digitaltwin/<format>/Communication/_batch` targeting
  `ResearchSubject/$summary`.
- `org.hl7.fhir.r4` twin materialization now returns a document-style
  `Bundle`, while `org.hl7.fhir.api` returns claims-first resources with
  canonical `meta.claims` and stable `urn:uuid:` bundle entry `fullUrl`
  values.
- Refactored search parsing, composition filtering, FHIR data helpers, and
  indexed-claim resource rehydration out of `CompositionManager` into reusable
  utilities so the manager no longer carries most of the request-shape and
  reconstruction plumbing.
- Extended runtime capabilities, routing, shared section/catalog constants,
  JSDoc, environment templates, and generated OpenAPI profile documents to
  match the implemented digital twin search and materialization behavior.

## [1.16.0] - 2026-06-26

### Added
- Added a dedicated `docs-v2/18-organization-controller-lifecycle.md` guide
  that explains the narrow controller recovery/rebind lifecycle, the direct GW
  route order, and the relationship to the canonical `gdc-sdk-node-ts`
  executable proof.
- Added `docs-v2/19-key-custody-and-audit-readiness.md` so the current KMS
  persistence model, the residual `KEK_SECRET` weakness, and the production
  migration target toward external KMS/HSM custody are documented in the v2
  docs set.
- Added `docs-v2/21-research-digital-twin-technical-backlog.md` so the
  separate research-store plan now has a code-targeted backlog for
  `server-config.ts`, research-store adapters, and the initial explicit
  `digitaltwin` search contract.
- Added `docs-v2/23-digital-twin-composition-search-contract.md` so the
  now-implemented `digitaltwin/.../Composition/_search` contract has one
  concise source of truth for accepted parameters, section/resource support,
  and step-by-step test flow.
- Added `npm run kms:audit` to report tenants/host missing persisted
  `wrapped_keys` and flag whether confidential-data decryption or HMAC-backed
  search is at risk.
- Added explicit envelope-root provider selection for wrapped key custody:
  `memory`, `local`, `gcp-kms`, and `hashicorp-transit`. The HashiCorp option
  is named after the Transit engine on purpose so it is not confused with the
  GW confidential storage vault.

### Changed
- Extended the generated Swagger/OpenAPI examples so the organization
  controller lifecycle now exposes explicit request, poll-request, and
  completed poll-response examples for:
  - `Organization/_issue`
  - `Organization/_activate`
  - `Token/_exchange-response`
  - `Device/_dcr-response`
- Aligned both Swagger generation paths
  (`src/utils/swagger-spec.ts` and `scripts/generate-swagger-spec.mts`) so
  tests and generated profile documents consume the same organization
  controller example set.
- Moved generated core flow examples out of `artifacts/` and into
  `docs/openapi-examples/core-flow-examples.json` so versioned example
  documents live alongside the rest of the published API contract.
- Updated controller-facing bearer authentication so host registry and other
  bearer-protected API routes can accept either a verified `id_token` or one
  signed controller proof bearer (`vp_token` compact JWT with embedded public
  JWK). `Token/_exchange` remains `id_token`-specific.
- Tightened host tenant lifecycle authorization so controller proof bearers
  must carry a legal representative VC whose `memberOf.taxID` matches the
  target `Organization.identifier.value`. Representative-role and
  subject-to-signer binding checks remain future tightening work until the
  example VC/VP contract is finalized.
- Bootstrapping now resolves wrapped-key envelope custody through an explicit
  provider factory instead of implicitly falling back from `KEK_SECRET` to
  in-memory behavior.
- Operational `MedicationStatement` updates now mirror into the tenant
  `digitaltwin` scope, and GW exposes
  `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search` for
  tenant-scoped twin discovery by canonical medication claims.
- `Communication`-driven IPS ingestion now mirrors projected clinical
  resources and per-section `Composition` indexes into `digitaltwin`, and
  GW exposes `digitaltwin/org.hl7.fhir.r4/Composition/_search` plus
  `digitaltwin/org.hl7.fhir.api/Composition/_search` for section-first twin
  discovery by IPS section token and resource-scoped textual claims such as
  `MedicationStatement.code-display`, `MedicationStatement.code-text`,
  `Observation.code-display`, and `Observation.code-text`.

### Fixed
- Restored legacy host `Organization/_activate` commercial continuity so the
  completed activation response again includes `org.schema.Offer.identifier`
  and the follow-up `Order/_batch` step can confirm the generated Offer for
  employee-seat licensing and activation-code issuance.
- Employee `DELETE` disable and `Employee/_purge` now resolve the target actor
  from explicit `Bundle.entry.resource.id` before deriving fallback IDs from
  claims, so SDK callers that send the canonical employee `resource.id` no
  longer hit random UUID lookups and false `404 Employee with ID ... not
  found` responses.
- Persisted tenant and host KMS key material as wrapped records in the host
  vault so plaintext async flows keep encrypting responses to the tenant after
  process restarts or pod hops instead of failing when `_managedKeys` memory is
  empty. `KmsService.init()` now reuses persisted host keys instead of silently
  reprovisioning a new host keyset on each restart.
- Restored the documented tenant `didDocument` fallback for public encryption
  key resolution so legacy tenants can still receive plaintext async responses
  when their published ML-KEM key exists even if wrapped private material is
  missing in the current process.
- Medication digital twin search now supports deterministic medication
  text/code lookup over mirrored `MedicationStatement` claims, so updating an
  individual's medication can update the mirrored twin and make it searchable
  by medication text or code.
- Full IPS document ingestion no longer fails when an embedded `Consent`
  lacks the rule-specific `Consent.decision` claim; the resource is still
  projected, while consent-rule persistence now runs only when the minimal
  rule claim set is present.

### Testing
- `npm test -- --runTestsByPath src/__tests__/integration/server.robustness.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/security-mode-gates.test.ts src/__tests__/managers/AuthorizationManager.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/services/KmsService.test.ts src/__tests__/integration/tenant-kms-rehydration.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/managers/MedicationStatementManager.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/managers/CompositionManager.test.ts src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/medication-statement.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/composition.bundle-search.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/utils/swagger-spec.test.ts`
- `npm run build:swagger`
- `npm run build`

## [1.15.0] - 2026-06-25

### Added
- Added a dedicated `docs-v2/18-organization-controller-lifecycle.md` guide
  that explains the narrow controller recovery/rebind lifecycle, the direct GW
  route order, and the relationship to the canonical `gdc-sdk-node-ts`
  executable proof.
- Added optional `STORAGE_PROVIDER=ipfs` support through a Kubo-backed
  `IpfsStorageAdapter`, plus local IPFS compose/runtime templates for the
  supported `DB_PROVIDER=postgres` + `STORAGE_PROVIDER=ipfs` profile.

### Changed
- Extended the generated Swagger/OpenAPI examples so the organization
  controller lifecycle now exposes explicit request, poll-request, and
  completed poll-response examples for:
  - `Organization/_issue`
  - `Organization/_activate`
  - `Token/_exchange-response`
  - `Device/_dcr-response`
- Aligned both Swagger generation paths
  (`src/utils/swagger-spec.ts` and `scripts/generate-swagger-spec.mts`) so
  tests and generated profile documents consume the same organization
  controller example set.
- Moved generated core flow examples out of `artifacts/` and into
  `docs/openapi-examples/core-flow-examples.json` so versioned example
  documents live alongside the rest of the published API contract.
- Updated controller-facing bearer authentication so host registry and other
  bearer-protected API routes can accept either a verified `id_token` or one
  signed controller proof bearer (`vp_token` compact JWT with embedded public
  JWK). `Token/_exchange` remains `id_token`-specific.
- Tightened host tenant lifecycle authorization so controller proof bearers
  must carry a legal representative VC whose `memberOf.taxID` matches the
  target `Organization.identifier.value`. Representative-role and
  subject-to-signer binding checks remain future tightening work until the
  example VC/VP contract is finalized.
- Documented and tested the open-source persistence profile that stores vault
  metadata in PostgreSQL and confidential blobs in IPFS/Kubo.

### Testing
- `npm test -- --runTestsByPath src/__tests__/integration/server.robustness.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/security-mode-gates.test.ts src/__tests__/managers/AuthorizationManager.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/config/server-config.test.ts src/__tests__/unit/database/storage/ipfs.storage.adapter.test.ts src/__tests__/integration/repositories/postgres.vault.repository.it.spec.ts`
- `npm run build`

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

## Legacy notes: DocumentReference and onboarding

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

## Legacy notes: trust-bundle tooling

### Added
- Added `npm run pki:bundle` plus `scripts/generate-trust-bundle.ts` and
  `scripts/examples/trust-bundle.local.example.json` to orchestrate
  reproducible Root CA -> ICA -> host -> member trust material generation from
  one config file.
- Added SHA-256 `manifest.json` publication for generated PKI artifact
  directories so local trust bundles can be inspected and audited offline.
- Added `docs-v2/25-trust-bundle-and-local-network-runbook.md` and
  `docs-internal/04-trust-bundle-operator-roles.md` to document the
  reproducible trust bundle, operator roles, and the ownership split between
  `gwtemplate-node-ts`, `dataspace-ica-ts`, and `gdc-sdk-node-ts`.

## Legacy change log fragments

### Controller and compatibility work

- Publish the organization-controller `License/_search` capability for new
  tenants and retain that exact read-only inventory operation for historical
  tenants that already exposed `Employee/_search`. This prevents failed seat
  discovery from being presented as an authoritative zero without widening
  licence mutations.
- In compatibility/demo deployments, delegate standards-based compact JWE
  requests and responses to the real KMS implementation. The simulated
  ciphertext-as-JSON path now applies only to explicit
  `alg=none`/`enc=none` envelopes, preventing real encrypted controller
  operations from failing with UTF-8 decoding errors.

  revocable employee signer registry until DID publication, and preserve the
  single postal code through Order, exchange and DCR using its protected VC
  binding.

- Fail closed when a Test Network organization-authorization VC is sent to a
  non-Test-Network route or runtime. Keep `verification.resourceType` as the
  canonical `contract` resource type and derive the registration environment
  from authoritative host routing.

### Existing-tenant controller promotion

- Existing-tenant `Organization/_issue` now promotes an ICA-approved stable
  controller `did:web` and its complete public JWKS into the tenant registry,
  provided the verified request signer belongs to that submitted keyring. In
  Fabric-backed modes it also records each public key and its active
  `legal-organization-controller-signing` binding; external key use remains
  separate.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
