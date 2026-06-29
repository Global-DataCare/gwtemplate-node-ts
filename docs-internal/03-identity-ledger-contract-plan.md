# Identity Ledger Contract Plan

Status date: 2026-06-28  
Audience: internal engineering, audit prep, and closeout planning.

## Why This Is Still Missing

The current local audited baseline already proves:

- consent lifecycle on `health-care-local`
- GW CORE writing business/audit state to Fabric

But it does **not** yet prove the complementary identity-key traceability on
`identity-local` for:

- tenant organizations
- employees
- individual controllers
- software/application public keys
- later suspension, expiry, revocation, and deactivation effects

That is the remaining ledger-side gap if the project wants a coherent story for
identity, not only for consent.

## Current Code Reality

This repo already contains separate JavaScript chaincode packages for the main
identity families:

- `chaincode/organization-sc-javascript`
- `chaincode/employee-sc-javascript`
- `chaincode/cryptographickey-sc-javascript`
- `chaincode/credential-sc-javascript`
- `chaincode/evidence-sc-javascript`

So the missing problem is not “start from zero”.  
The missing problem is:

1. make the asset model relational enough
2. stop overloading one key as if it belonged to only one subject
3. distinguish identity lifecycle from key lifecycle
4. package the contracts on `identity-local` in one audited flow

## The Core Modeling Rule

Do **not** model:

- employee disable = key revoke
- tenant purge = all historical keys deleted
- individual disable = controller key revoked everywhere

That would be wrong because one public key may legitimately be referenced by
more than one subject, especially:

- one controller key controlling multiple individuals
- one application signing key reused by several flows
- one tenant key rotated while old proofs remain historically valid

So the ledger must separate:

1. subject lifecycle
2. key lifecycle
3. subject-to-key binding lifecycle
4. credential/license/evidence lifecycle

## Recommended Identity Contract Split

### 1. `organization-sc`

Responsibility:

- tenant/legal organization identity state
- sector/service DID registration
- organization status changes

It should **not** own the final truth of every key bound to that organization.

### 2. `employee-sc`

Responsibility:

- employee/professional identity state
- role and status
- optional employee DID metadata

It should **not** directly revoke shared keys.

### 3. `cryptographickey-sc`

Responsibility:

- canonical public-key material registry
- one asset per public key or per `kid/thumbprint`
- status of the key itself:
  - `active`
  - `suspended`
  - `revoked`
  - `expired`

This is where the actual public key lifecycle belongs.

### 4. New required contract: `subjectkeybinding-sc`

This is the missing piece.

Responsibility:

- track which subject is allowed to use which key
- allow one key to be bound to many subjects
- allow one subject to hold several keys
- suspend/revoke one binding without revoking the key globally

This contract is the right place for:

- employee license disabled -> binding suspended
- individual removed -> binding revoked only for that individual
- controller still controlling other individuals -> same key remains active on
  the other bindings

### 5. `credential-sc`

Responsibility:

- VC/license/credential status traceability
- distinguish issued/suspended/revoked/expired credential state from key state

### 6. New required contract: `artifact-sc`

Responsibility:

- canonical registry of PDF/image/document artifacts
- hash/CID identity of the artifact itself
- current aggregate state of that artifact

This is the `product-sc` equivalent.

### 7. New required contract: `artifactevent-sc`

Responsibility:

- appendable event records linked to one artifact
- validation events
- declaration events
- OIDC4IDA evidence events
- employee/manual validation events
- supersession/revocation events

This is the `event-sc` equivalent.

### 8. `evidence-sc`

Responsibility:

- reusable evidence payload registry when one evidence object needs its own
  independent lifecycle or deduplication
- KYC/evidence hashes
- signed onboarding evidence
- later audit references

In the simplest implementation, `artifactevent-sc` may inline an evidence hash
or pointer and `evidence-sc` can remain optional.

## Subject-Key Binding Asset

Recommended asset id:

`<subjectType>_<subjectId>__<keyId>`

Examples:

- `organization_ES_VAT_ESB12345678__ES_VAT_ESB12345678_kid-main-1`
- `employee_ES_VAT_ESB12345678_admin1@acme.org__thumbprint-abc`
- `controller_did:web:api.acme.org:individual:subject-001__thumbprint-ctrl-1`

Stored fields:

```json
{
  "bindingId": "controller_did:web:api.acme.org:individual:subject-001__thumbprint-ctrl-1",
  "subjectType": "controller",
  "subjectId": "did:web:api.acme.org:individual:subject-001",
  "parentOrgId": "ES_VAT_ESB12345678",
  "keyId": "thumbprint-ctrl-1",
  "relationship": "controller-signing",
  "status": "active",
  "createdAt": 1733886400,
  "updatedAt": 1733886400,
  "suspendedAt": null,
  "revokedAt": null,
  "expiresAt": null,
  "reason": null,
  "metadata": {
    "did": "did:web:people.acme.org:controllers:primary",
    "kid": "explicit-controller-sig-kid"
  }
}
```

Allowed `subjectType` values:

- `organization`
- `employee`
- `controller`
- `software-application`
- `device`

Allowed `relationship` examples:

- `organization-signing`
- `organization-encryption`
- `employee-device-signing`
- `controller-signing`
- `controller-encryption`
- `software-transport-signing`
- `software-transport-encryption`

## Lifecycle Semantics

### When a tenant organization is disabled

- `organization-sc`: organization status -> `suspended`
- `subjectkeybinding-sc`: tenant bindings -> `suspended`
- `cryptographickey-sc`: keys remain `active` unless there is an independent
  security reason to revoke them

### When an employee license is disabled or purged

- `employee-sc`: employee status -> `suspended` or `revoked`
- `credential-sc`: employee credential/license status updated
- `subjectkeybinding-sc`: employee-key bindings -> `suspended` or `revoked`
- `cryptographickey-sc`: key remains unchanged unless the key itself is
  compromised

### When an individual is disabled/purged

- the individual/member lifecycle should revoke or suspend the bindings that
  tie that subject/controller relation to the individual
- the controller public key should **not** be globally revoked if the same
  controller still controls other individuals

## Closed Inter-Tenant Contract Model

This closeout now fixes the canonical semantic model for inter-tenant access
contracts between two hosted tenants such as `acme-id` and `lab-id`.

### Primary Verifiable Object

The primary business object is:

- one VC representing the inter-tenant agreement

That VC contains:

- `credentialSubject = FHIR Contract`
- one or more `proof[]` entries, typically one per signing controller
- VC metadata such as issuer, validity window, and presentation use

Important rule:

- the FHIR `Contract` is the canonical interoperable agreement payload
- the VC is the canonical cryptographic/legal transport container
- `Provenance` is a derived FHIR audit projection, not the primary signature
  container

### FHIR `Contract` Semantics

For the current implemented branch, the contract claims-first model is:

- `Contract.identifier`
- `Contract.status`
- `Contract.issued`
- `Contract.applies-start`
- `Contract.applies-end`
- `Contract.provider-organization`
- `Contract.consumer-organization`
- `Contract.provider-controller`
- `Contract.consumer-controller`
- `Contract.security-label`
- `Contract.term-type`
- `Contract.instantiates-uri`

Meaning:

- provider organization = tenant exposing or controlling the data
- consumer organization = foreign tenant requesting access
- security label = allowed capability, for example
  `organization/Composition.rs`
- term type = allowed purpose, for example `RESEARCH`
- `instantiates-uri` = the signed agreement PDF/CID or direct contractual
  annexes

Explicit non-goal for the minimum model:

- invoice/payment timing is not mandatory in the first canonical contract
  object, because invoicing may happen before, during, or after signature

### Supporting Documents

If commercial or supporting documents are needed, the semantic split is:

- `Contract.instantiatesUri`
  - primary signed agreement PDF/CID
- `Contract.supportingInfo`
  - optional supporting documents such as invoice, annexes, or
    `DocumentReference`

So the invoice is not modeled as the core meaning of `instantiatesUri`.

### VC Proofs, `Provenance`, and Ledger History

The cryptographic source of truth is:

- VC `proof[]`
- plus the corresponding ledger artifact/event records

FHIR audit projection may be derived as:

- one `Provenance` per VC `proof`
- or one `Provenance` per lifecycle event where that is more useful for audit

Recommended interpretation:

- `VC.proof[]` = actual controller signatures
- `Contract.relevantHistory` = references to derived `Provenance` or other
  audit/history resources
- ledger events = append-only operational trace of declaration, countersign,
  suspension, revocation, expiry, or supersession

So `relevantHistory` must not be treated as a comma-separated storage of raw
proof ids. It is the FHIR history view, not the native cryptographic payload.

### Ledger Projection

For closeout purposes, the recommended ledger split is:

- `artifact-sc`
  - artifact record for the agreement PDF/CID
  - optional artifact record for the VC itself when the VC hash must be
    anchored independently
- `artifactevent-sc`
  - declaration event
  - countersignature event
  - suspension event
  - revocation event
  - expiry event
  - supersession event
- `credential-sc`
  - VC status when the credential lifecycle must be tracked separately from
    the artifact

### SMART Authorization Gate

The currently implemented GW rule is:

- if the requesting actor belongs to the same organization as the token issuer,
  no inter-tenant contract VC is required
- if the requesting actor belongs to a different organization, the presenter
  must carry a VP containing one active matching inter-tenant contract VC

The match is evaluated against:

- provider organization DID
- consumer organization DID
- required capability/scope
- required purpose

Current intentional scope limitation:

- this is modeled today for two tenants, potentially on the same host
- it does not claim host-side aggregate publication of `system/ResearchSubject`
  or cross-host digital twin publication

### Reuse Of `consentaccess-sc` For Consumer-Org Delegation

The current preferred design is to reuse the existing consent-access pattern
almost completely for the consumer-organization side delegation:

- issuer/owner of the rule = consumer organization controller
- delegated actor = employee/researcher of that consumer organization
- protected subject = consumer organization DID
- action = allowed capability, for example `organization/ResearchSubject.rs`
  or `organization/Composition.rs`
- purpose = allowed business reason such as `RESEARCH`
- `Consent.source-reference` = blockchain-safe reference of the contract VC

So the same atomic-rule export pattern can be kept:

- `Consent`-style rule stored off-chain for query/evaluation
- `buildConsentRulePrimaryDocument(...)` projection to one atomic blockchain
  asset per rule
- `assetId = CIDv1(SHA3-384(canonicalRuleId))`

The additional contract-specific rule is:

- the reused consent rule must point to the inter-tenant contract VC through
  `Consent.source-reference`

Canonical persisted identifiers for these rules should no longer use domain or
`did:web` values as the primary ledger key. The canonical stable format is:

- organization: `urn:org:<id-type-lowercase>:<id-value>`
- member: `urn:org:<id-type-lowercase>:<id-value>:member:<member-id>`

Role is still relevant, but it must be carried separately in rule/credential
claims such as `Consent.actor-role`, not embedded into the canonical member id.

Legacy short inputs such as `TAX|VATES-B12345678` are only accepted as manager
input and must be normalized to the canonical URN before persistence, hashing,
or blockchain registration.

That lets the verifier answer both questions deterministically:

1. does a valid provider-consumer contract VC exist?
2. did the consumer organization delegate this specific employee to use that
   contract for this capability/purpose?

### When a key is compromised

- `cryptographickey-sc`: key status -> `revoked`
- `subjectkeybinding-sc`: all bindings referencing that key should be marked
  `revoked` in the same orchestration flow

That is the one case where key state fans out into many bindings.

## Reuse From `consentaccess-sc`

Do not reuse the business payload shape from `consentaccess-sc`.

Do reuse its implementation pattern:

- one contract per asset family
- lowercase/uppercase method aliases
- world-state asset for current state
- Fabric history as authoritative revision trail
- deterministic on-chain normalization before write
- idempotent upsert where appropriate

Specifically reusable ideas:

- `buildHistory(...)`
- `exists/read/write` helper split
- sanitization before persistence
- no embedded mutable history arrays in the asset itself

That same pattern should also be used for `artifact-sc`,
`artifactevent-sc`, `evidence-sc`, and
`subjectkeybinding-sc`, so the identity-side chaincodes behave like
`consentaccess-sc` operationally even though they persist different business
objects.

## Artifact And Event Semantics

This is the second missing half besides `subjectkeybinding-sc`.

The ledger must distinguish at least these states:

1. artifact hash exists, but no validating evidence exists yet
2. artifact hash was uploaded/declared by an individual controller only
3. artifact hash was validated by an employee/professional
4. artifact hash was validated by ICA `_verify`
5. artifact hash later became superseded, expired, or revoked

So the model should not only store “one hash”.

It should separate:

- artifact/product identity
- event stream over that artifact
- optional independent evidence object

### Recommended artifact asset in `artifact-sc`

Recommended asset id:

`artifact_<hashAlg>_<hashValue>`

or, if CID exists:

`artifact_cid_<cid>`

Stored fields:

```json
{
  "artifactId": "artifact_sha256_abcd1234",
  "cid": "bafy...",
  "hash": "abcd1234",
  "hashAlg": "sha256",
  "artifactType": "pdf",
  "declaredBy": "did:web:api.acme.org:individual:subject-001",
  "declaredByType": "controller",
  "status": "declared",
  "createdAt": 1733886400,
  "updatedAt": 1733886400,
  "validatedAt": null,
  "validationCount": 0,
  "metadata": {
    "filename": "onboarding.pdf"
  }
}
```

Recommended `status` values:

- `declared`
- `validated`
- `superseded`
- `revoked`
- `expired`

### Recommended artifact event asset in `artifactevent-sc`

Recommended asset id:

`<artifactId>__<eventId>`

Stored fields:

```json
{
  "eventId": "artifact_sha256_abcd1234__verify-20260628-001",
  "artifactId": "artifact_sha256_abcd1234",
  "eventType": "validation",
  "eventSubType": "oidc4ida-verify",
  "actor": "did:web:ica.example.org",
  "actorType": "ica",
  "status": "active",
  "issuedAt": 1733886400,
  "expiresAt": null,
  "revokedAt": null,
  "artifactHash": "sha256-of-verified-pdf",
  "artifactHashAlg": "sha256",
  "evidenceHash": "sha256-of-evidence-payload-or-jws",
  "evidenceHashAlg": "sha256",
  "evidenceRef": "evidence_oidc4ida_abc123",
  "metadata": {
    "route": "terms/pdf/Organization/_verify",
    "jurisdiction": "ES",
    "sector": "health-care"
  }
}
```

Recommended `eventType` values:

- `declaration`
- `validation`
- `supersession`
- `revocation`
- `expiry`

### Optional evidence asset in `evidence-sc`

Use this only when the evidence payload itself needs independent lookup,
deduplication, or lifecycle.

Recommended asset id:

`evidence_<evidenceType>_<evidenceHash>`

Stored fields:

```json
{
  "evidenceId": "evidence_oidc4ida_abc123",
  "evidenceType": "oidc4ida-verify",
  "issuer": "did:web:ica.example.org",
  "hash": "sha256-of-evidence-payload-or-jws",
  "hashAlg": "sha256",
  "status": "active",
  "issuedAt": 1733886400,
  "expiresAt": null,
  "metadata": {
    "format": "oidc4ida"
  }
}
```

## ICA `_verify` As Ledger Input

Yes: the result returned by ICA `_verify` is exactly the kind of thing that
should be registrable on `identity-local`.

The canonical write should be:

1. register or upsert the verified artifact hash/CID in `artifact-sc`
2. append one validation event in `artifactevent-sc`
3. optionally register the evidence payload/hash in `evidence-sc`
4. optionally attach subject-key bindings or organization/controller updates
   derived from that verification

The important separation is:

- artifact hash/CID = “what document/artifact are we talking about”
- artifact event = “what happened to this artifact”
- evidence object = “what proof payload supports that event”
- binding/organization/employee update = “what lifecycle consequence did GW
  derive from that proof”

## OIDC4IDA Evidence Mapping

The evidence type should explicitly support ICA-side OIDC4IDA-like evidence.

Recommended `evidenceType` values:

- `oidc4ida-verify`
- `oidc4ida-add-evidence`
- `employee-manual-validation`
- `controller-self-declaration`

This allows these distinctions:

- controller uploaded a PDF hash but there is no third-party validation yet:
  - artifact status `declared`
  - one `declaration` event
  - optional `controller-self-declaration` evidence
- employee validated an image/PDF inside the provider workflow:
  - `validation` event with subtype `employee-manual-validation`
  - artifact status can move to `validated`
- ICA verified the PDF cryptographically:
  - `validation` event with subtype `oidc4ida-verify`
  - optional linked evidence object in `evidence-sc`
  - artifact status `validated`

## Required GW Flow

For the current architecture, GW should be the writer of this projection.

Concrete rule:

- ICA `_verify` returns the verification output
- GW extracts:
  - PDF hash and/or CID
  - evidence payload or evidence hash
  - validating actor/source
  - affected organization/controller/employee identifiers
- GW writes:
  - `artifact-sc` record
  - `artifactevent-sc` validation event
  - optional `evidence-sc` record
  - any `organization-sc` / `employee-sc` / `subjectkeybinding-sc` updates

This keeps one authoritative business/audit trace in GW-driven Fabric writes.

## Minimal JS Contract API For `subjectkeybinding-sc`

Recommended methods:

- `CreateSubjectKeyBinding(bindingId, payload)`
- `UpsertSubjectKeyBinding(bindingId, payload)`
- `GetSubjectKeyBinding(bindingId)`
- `ListBindingsBySubject(subjectType, subjectId)`
- `ListBindingsByKey(keyId)`
- `ListActiveBindingsByKey(keyId)`
- `UpdateBindingStatus(bindingId, status, ts, actor, reason, metadata?)`
- `SuspendBindingsBySubject(subjectType, subjectId, ts, actor, reason)`
- `RevokeBindingsBySubject(subjectType, subjectId, ts, actor, reason)`
- `RevokeBindingsByKey(keyId, ts, actor, reason)`
- `GetSubjectKeyBindingHistory(bindingId)`

Required indexes:

- `subject~binding`
- `key~binding`

## GW CORE Write Responsibility

Keep the same responsibility split already adopted for consent:

- ICA proves/attests
- GW CORE owns business lifecycle decisions
- GW CORE writes identity and key-binding anchors to Fabric

Why:

- employee disable/purge already lives in GW lifecycle
- individual/controller relations already live in GW lifecycle
- GW knows when a relation was disabled for business reasons, not just crypto
  reasons

ICA may still write independent credential-status events if needed, but GW
should remain the writer of host-side lifecycle projections.

## Suggested Implementation Order

1. Harden `cryptographickey-sc`
   - add richer metadata
   - add search/index methods if needed
2. Add new `subjectkeybinding-sc`
3. Extend GW adapter layer with explicit identity-ledger write methods
4. Wire tenant/employee/controller lifecycle events from GW managers
5. Add one local audited smoke on `identity-local`

## Closeout Acceptance For This Area

Minimum evidence to claim this area closed:

1. create tenant organization and register its key
2. create employee and bind one employee key
3. create one controller bound to two individuals
4. upload one PDF/image hash as controller-only declaration
5. prove it exists without ICA/employee validation evidence
6. validate one PDF through ICA `_verify`
7. prove the artifact hash/CID plus OIDC4IDA evidence is visible on
   `identity-local`
8. disable one individual
9. prove only that individual's binding is revoked/suspended
10. prove the same controller key remains active through the other binding
11. disable one employee
12. prove employee binding/credential status changes are visible on
   `identity-local`

Without that, the identity ledger story is still incomplete.
