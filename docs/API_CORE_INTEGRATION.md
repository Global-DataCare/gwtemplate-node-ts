# API Core Integration (SEDIA UC Baseline)

Purpose: canonical, demonstrable integration flow for developers and AI agents.

This document is intentionally narrower than `API_INTEGRATORS_GUIDE.md` and mirrors the live SDK core E2E flow.

Short coverage summary for memory/thesis justification:
- `../TEST_CORE.md`

## Source-of-Truth Alignment

- GW OpenAPI core profile served at: `/api-docs` (`/swagger-spec.json`).
- GW full/reference OpenAPI served at: `/api-docs-reference` (`/swagger-spec.reference.json`).
- SDK live core tests: `dataspace-client-sdk-node/tests/live-gw-uc5.e2e.test.mjs`.
- Payload examples in GW OpenAPI are generated from GW test fixtures (`src/__tests__/data/example-payloads.ts`) and must stay semantically aligned with SDK examples.

## Canonical Flow (End-to-End)

1. Host tenant activation from ICA proof
- Submit: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
- Poll: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response`
- SDK method: `activateOrganizationInGatewayFromIcaProof(...)`
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
- Claim-teaching rule:
  - examples should prefer shared `ClaimsOrganizationSchemaorg`, `ClaimsPersonSchemaorg`, and `ClaimsServiceSchemaorg` constants instead of hardcoded claim-key strings
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
  - `credentialSubject.hasCredential.material` must be present (email/signing-key continuity material).

2. Host order acceptance
- Submit: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch`
- Poll: `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response`
- Output includes first activation code in `org.schema.IndividualProduct.serialNumber`

3. Employee device identity bootstrap
- After `Order/_batch`, the controller uses the activation code (`org.schema.IndividualProduct.serialNumber`) to run:
`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange` (+ poll),
exchanging the email-proof `id_token` for the `initial_access_token` required by DCR.
- Then the controller runs:
`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr` (+ poll),
binding wallet public key(s) to that license serial number and controller email before creating additional employees.
- SDK method chain: `activateEmployeeDeviceWithActivationCode(...)`
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
- Follow-up authorization matrix task:
  - [../../gdc-common-utils-ts/docs/consent-access-matrix-task.md](../../gdc-common-utils-ts/docs/consent-access-matrix-task.md)
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
- Current core baseline keeps `_activate` + `_activate-response` as first-class canonical onboarding steps.
