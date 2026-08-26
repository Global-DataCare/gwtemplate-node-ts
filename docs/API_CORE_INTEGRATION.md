# API Core Integration (SEDIA UC Baseline)

Purpose: canonical, demonstrable integration flow for developers and AI agents.

This document is intentionally narrower than `API_INTEGRATORS_GUIDE.md` and mirrors the live SDK core E2E flow.

Short coverage summary for memory/thesis justification:
- [`TEST_CORE.md`](TEST_CORE.md)

## Source-of-Truth Alignment

- Visual public/internal contract map:
  [01.I-GW-CORE-CONTRACT-MAP.md](01-OVERVIEW-AND-GUIDES/01.I-GW-CORE-CONTRACT-MAP.md).
- GW OpenAPI core profile served at: `/api-docs` (`/swagger-spec.json`).
- GW full/reference OpenAPI served at: `/api-docs-reference` (`/swagger-spec.reference.json`).
- SDK live core tests: `dataspace-client-sdk-node/tests/live-gw-uc5.e2e.test.mjs`.
- Payload examples in GW OpenAPI are generated from GW test fixtures (`src/__tests__/data/example-payloads.ts`) and must stay semantically aligned with SDK examples.
- Communication layering source of truth:
  - [101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- IPS outbox/source flow:
  - [101-IPS_COMMUNICATION_OUTBOX.md](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/docs/101-IPS_COMMUNICATION_OUTBOX.md)

## Wire Contract Memory Aid

When integrating with GW CORE, keep these layers separate:

1. DIDComm/FAPI envelope.
2. Batch body.
3. Resource payload whose canonical semantics live in `resource.meta.claims`.

Important distinctions:

- `DidComm.type` is the transport/protocol message type.
- `BundleEntry.type` is a project-specific internal batch message kind. It is not FHIR.
- `resource.resourceType` is the outer resource shape or projection.
- `resource.meta.claims` is the canonical project-specific claims contract. It is not part of base FHIR.
- `Communication.contentdata` is one of those claims when the communication carries embedded payload data.

Teaching rule:

- New developers should author canonical `resource.meta.claims` first.
- FHIR-shaped payloads are optional projections or compatibility shapes around that canonical claims model.
- Internal gateway models such as `CommMsgExtended` are derived/internal and are not the primary client contract.

## Canonical Flow (End-to-End)

1. Host legal-organization verification transaction
- Submit: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction`
- Poll: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response`
- This is the canonical first step for legal-organization onboarding in GW CORE.
- This flow does not require `Organization/_activate` as a follow-up step.
- GW forwards the signed PDF evidence and business payload to ICA `_verify`.
- Required business payload input:
  - `body.data[].resource.controller.publicKeyJwk`
  - optional `body.data[].resource.organization.publicKeyJwk`
  - optional `body.data[].resource.legalRepresentativePayload.email`
- Key-separation rule:
  - `meta.jws.protected.jwk` and `meta.jwe.header.jwk` are communication/runtime keys of the portal app, device profile, confidential app, or BFF
  - `body.data[].resource.controller.publicKeyJwk` is the controller operation-signing key that ICA should project into `credentialSubject.hasCredential.material`
  - `body.data[].resource.organization.publicKeyJwk` is the organization credential-signing key when already known by the hosting runtime

2. Legacy compatibility: host tenant activation from ICA proof
- Submit: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
- Poll: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response`
- SDK method: `activateOrganizationInGatewayFromIcaProof(...)`
- This route remains available for ICA-proof-first callers, but it is legacy compatibility and is not required after `Organization/_transaction`.
- Host routing note:
  - the SDK host route object is a host/operator routing context
  - do not teach it as if it were the identity of the legal controller
- Required proof input: `body.data[].vp_token` (JWT) or `body.data[].vp` (JSON VP)
- Canonical proof is `body.vp_token`.
- `organizationCredential` / `representativeCredential` are deprecated legacy compatibility side-fields and must not be treated as the primary proof contract.
- Optional explicit controller binding input for immediate person-DID publication:
  - `body.controller.did`
  - `body.controller.sameAs`
  - `body.controller.publicKeyJwk`
  - `body.controller.jwks`
- Representative proof model:
  - `credentialSubject.sameAs`
    public identity continuity of the representative/controller
  - `credentialSubject.hasCredential.material`
    signing-key continuity of the controller binding
  - production-grade ICA proofs should ideally carry both dimensions
- Indexed-contact canonicalization rule:
  - for email-based ICA identity continuity, examples should prefer canonical
    `urn:multibase:z...` in `controller.sameAs` instead of `mailto:...`
  - indexed email attributes must be normalized to plain lowercase email without the `mailto:` prefix
  - indexed phone attributes must be normalized to `tel:+<digits>` without formatting spaces or separators
  - storage and query inputs must use the same canonicalization before HMAC/index protection
- Claim-teaching rule:
  - examples should prefer shared `ClaimsOrganizationSchemaorg`, `ClaimsPersonSchemaorg`, and `ClaimsServiceSchemaorg` constants instead of hardcoded claim-key strings
- Service capability rule:
  - legal-organization `_activate` must declare service capabilities in `org.schema.Service.serviceType`
  - example values: `organization/Composition.rs`, `organization/Composition.cruds`, `organization/ResearchSubject.rs`, `organization/ResearchSubject.cruds`
  - GW persists those claims and now uses them to decide which tenant API endpoints are published in DID discovery
  - the same persisted capability claim also drives DSP discovery artifacts:
    - `GET /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/dspace-version`
    - `GET /host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/dcat.json`
    - `GET /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/dspace-version`
    - `GET /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dsp/catalog/dcat.json`
    - `GET /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-index.json`
    - `GET /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-research.json`
  - `org.schema.Service.category` remains the sector, not the capability vocabulary
  - if the activation omits the service capability claim, the legal-organization onboarding example is incomplete and should be treated as invalid teaching material
- Legal-organization teaching rule:
  - do not start the first legal-organization example from `org.schema.Organization.alternateName`
  - center it on legal name, `Organization.identifier.value` / tax-id linkage returned by ICA, controller binding, and provider service identity
  - in `v1.x`, GW CORE may still derive an internal compatibility alias from that canonical identifier when `alternateName` is omitted
- Runtime rule:
  - organization/provider DID publication uses GW/operator transport keys and real `serviceEndpoint` URLs
  - controller person DID publication uses explicit controller key material when provided
  - DIDComm `meta.jws.protected.jwk` / `meta.jwe.header.jwk` remain technical transport fallback, not the preferred person-key contract
- Representative VC security linkage (enforced):
  - `credentialSubject.memberOf.taxID` must match organization credential tax ID.
  - `credentialSubject.hasOccupation.identifier.value` must be `RESPRSN` (Responsible Party). Legacy tokenized formats are normalized for compatibility.
  - `credentialSubject.hasCredential.material` must be present (signing-key continuity material).
  - `credentialSubject.sameAs` is the complementary public-identity continuity dimension and should also be present in normal production ICA proofs.
- Legacy `_activate` usage guidance:
  - Use `_transaction` as the canonical host onboarding flow.
  - Use `_activate` only for callers that already start from an ICA VP proof and still rely on the older proof-consumption contract.
  - Prefer ICA responses where the representative VC already carries both `sameAs` and `hasCredential.material`.
  - Use `additionalClaims[org.schema.Person.email]` only as a demo/local bootstrap when GW must create the internal admin and the VC still lacks signed email continuity.
  - Treat `controller.sameAs` in `_activate` as a demo/local workaround, not as the normal production source of truth.

2.a. Planned tenant-side DID binding step
- Target route shape:
  `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Organization/_binding`
- Poll shape:
  `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Organization/_binding-response`
- Intended purpose:
  - replace the public `alsoKnownAs` alias list of the effective organization
    DID document
  - keep legal organization location separate from alias/public domain binding
- Locator rule:
  - accept exactly one organization locator:
    - `org.schema.Organization.taxID`, or
    - `org.schema.Organization.identifier.value`
  - do not accept both in the same request
- Alias rule:
  - `org.schema.Organization.url`, when present, replaces the existing
    `alsoKnownAs` list
  - omitting `Organization.url` preserves the current aliases
- Current publication status:
  - this route is not yet published by GW CORE in runtime/OpenAPI
  - SDKs may expose high-level methods already, but GW docs must keep it marked
    as pending until the actual route is served

2. Host order acceptance
- Submit: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch`
- Poll: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response`
- Output includes first activation code in `org.schema.IndividualProduct.serialNumber`

3. Modern controller/employee device identity bootstrap
- After canonical `Order/_batch`, the modern controller uses the activation code (`org.schema.IndividualProduct.serialNumber`) to run:
`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange` (+ poll),
exchanging the email-proof `id_token` for the `initial_access_token` required by DCR.
- Then the controller runs:
`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr` (+ poll),
binding wallet public key(s) to that license serial number and controller email before creating additional employees.
- SDK method chain: `activateEmployeeDeviceWithActivationCode(...)`
- Identity-layer rule:
  - onboarding / order confirms the human controller identity and business
    lifecycle
  - `Token/_exchange` + `Device/_dcr` registers the technical client/device/BFF
    identity that will operate afterwards
  - controller binding material does not replace DCR for a modern service
    controller or employee device
  - explicit legacy exception: historical `Organization/_activate` receives
    the representative `controllerBinding` and binds that submitted public key
    during tenant bootstrap; that same representative key does not repeat
    `Token/_exchange` or `Device/_dcr`
- DCR semantics in CORE:
  - registers the technical client/device/app identity
  - does not by itself publish or replace the human controller/professional DID document
- Member DID format used in CORE: `did:web:<owner-did...>:member:<member-id>:<role>`
- In CORE (SEDIA baseline), `<member-id>` is derived from email hash (multibase58/multihash profile).

4. Individual indexing tenant creation
- Submit individual organization: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch`
- Confirm offer/order: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch`
- SDK methods: `startIndividualOrganizationSimple(...)`, `confirmIndividualOrganizationOrderSimple(...)`

Note:
- This tenant-level individual offer→order flow is part of the active core profile (not legacy).

5. Consent rule grant for professional/member access
- Submit: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch`
- Poll: `.../Consent/_batch-response`
- SDK method: `grantProfessionalAccessSimple(...)`
- Boundary note:
  - this step governs authorization and access policy
  - it is not the canonical envelope for index mutation or index retrieval
  - index-facing operations in the active core profile travel through `Communication/_batch`
- Follow-up authorization matrix task:
  - [gdc-common-utils-ts/docs/consent-access-matrix-task.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/consent-access-matrix-task.md)
  - covers active consent aggregation, explicit deny precedence, controller views, permission-request communications, and final SMART scope evaluation

6. SMART token with consent/scope enforcement
- Submit: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token`
- Poll: `.../smart/token-response`
- SDK method: `requestSmartTokenSimple(...)`
- Token must be single-subject and section-scoped by requested scopes.
- Minimal teaching rule:
  - first show the composition read scope built from `subjectDid`
  - only add `organization/Consent.cruds` when the actor also needs consent management operations

7. IPS import and index update through Communication bundle
- Ingest: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Communication/_batch`
- Poll: `.../Communication/_batch-response`
- This is the canonical index-update entrypoint in core (bundle-driven ingestion).
- Teaching rule:
  - index operations are transported through `Communication`
  - do not teach `Consent/_batch` as the main exchange envelope for index operations
  - a single batch may carry one or more `Communication` entries depending on the flow
- Search (Bundle batch GET): indexed `Composition`/`DocumentReference` retrieval
- SDK method: `ingestCommunicationAndUpdateIndex(...)`
- Draft/outbox teaching rule:
  - if SDK docs show `createOutboxJobFromDraft(...)`, they must say explicitly that it only freezes the local payload/envelope
  - network submission starts later when the runtime client posts the communication

8. RelatedPerson baseline (emergency contact)
- Submit: `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`
- Poll: `.../RelatedPerson/_batch-response`
- SDK method: `upsertRelatedPersonAndPoll(...)`

## Contract Invariants

1. `DocumentReference.identifier` = logical identifier (UUID/URN).
2. `DocumentReference.contenthash` = content CID/hash.
3. Atomic async pattern is mandatory: submit endpoint + poll endpoint.
4. `resource.meta.claims` remains canonical claims carrier.

## What is intentionally out of this core profile

- Legacy aliases and internal compatibility routes.

## Planned alternative path (confidential app / portal mode)

- `*_batch` based activation/verification orchestration as a single confidential-client flow is tracked as pending TODO.
- Current core baseline keeps `_transaction` as the canonical legal-organization onboarding step. `_activate` remains only as a legacy proof-consumption compatibility route.
